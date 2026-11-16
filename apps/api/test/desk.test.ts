import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, ownerDb, schema, withScope } from '@tomoni/db';
import { systemScope } from '@tomoni/core';
import { runEngine } from '@tomoni/medicines';
import { buildServer } from '../src/server';
import { Client, makePracticeAndHousehold, makeUser, ORIGIN, totp } from './helpers';

let app: Awaited<ReturnType<typeof buildServer>>;
let ids: Awaited<ReturnType<typeof makePracticeAndHousehold>>;
let patientId = '';
let doctor: Client;
let nurse: Client;
let desk: Client;

async function staff(role: 'physician' | 'nurse' | 'front_desk', practiceId: string) {
  const c = new Client(app);
  await c.login((await makeUser(role, { practiceId })).email);
  const { secret } = (await c.req('POST', '/api/auth/mfa/enroll')).json();
  await c.req('POST', '/api/auth/mfa/enroll/confirm', { code: await totp(secret) });
  return c;
}

beforeAll(async () => {
  app = await buildServer({ config: { allowedOrigins: [ORIGIN], docs: false } });
  ids = await makePracticeAndHousehold();
  const db = ownerDb();
  const [p] = await db
    .insert(schema.patient)
    .values({
      practiceId: ids.practiceId,
      householdId: ids.householdId,
      name: '=HYPERLINK("http://x")',
      dob: '1953-01-01',
      birthYear: 1953,
      state: 'NJ',
      locale: 'en',
      tz: 'America/New_York',
      medicareType: 'original',
    })
    .returning();
  patientId = p!.id;
  await db.insert(schema.careConsent).values({
    patientId,
    practiceId: ids.practiceId,
    givenByKind: 'patient',
    method: 'written',
    copayDisclosed: true,
    givenAt: new Date('2026-10-01'),
  });
  await db.insert(schema.claim).values({
    patientId,
    kind: 'carrier',
    startDate: '2026-09-01',
    dxCodes: ['E11.9', 'I50.9'],
    source: 'manual',
    sourceRef: `c-${patientId}`,
  });
  await db.insert(schema.call).values({
    patientId,
    channel: 'simulator',
    locale: 'en',
    scriptVersion: 'v1',
    step: 'ended',
    disclosurePlayed: true,
    outcome: 'completed',
    startedAt: new Date('2026-11-04T15:00:00Z'),
  });
  doctor = await staff('physician', ids.practiceId);
  nurse = await staff('nurse', ids.practiceId);
  desk = await staff('front_desk', ids.practiceId);
});
afterAll(async () => {
  await app.close();
  await closePools();
});

describe('desk: patient, care plan, APCM', () => {
  it('shows a patient’s timeline to their practice only', async () => {
    const r = (await nurse.req('GET', `/api/desk/patients/${patientId}`)).json();
    expect(r).toMatchObject({ apcmEnrolled: true, carePlans: [] });
    expect(r.timeline.map((e: { kind: string }) => e.kind)).toContain('call');
    const other = await staff('nurse', (await makePracticeAndHousehold()).practiceId);
    expect((await other.req('GET', `/api/desk/patients/${patientId}`)).statusCode).toBe(404);
  });

  it('a nurse drafts, only the physician signs', async () => {
    const draft = (await nurse.req('POST', `/api/desk/patients/${patientId}/care-plan/draft`)).json();
    expect(draft).toMatchObject({ status: 'draft', version: 1, draftedBy: 'agent' });
    expect(draft.body.problems.map((p: { code: string }) => p.code)).toEqual(['diabetes', 'heart_failure']);
    const sign = (c: typeof nurse, revision: number) =>
      c.req('POST', `/api/desk/care-plans/${draft.id}/sign`, { revision });
    expect((await sign(nurse, 0)).statusCode).toBe(403);

    // The nurse edits the goals while the doctor has revision 0 open: signing 0 is refused.
    const goals = ['A1c under 8 by March, as Dr. Rao set.', 'Walk 20 minutes a day.'];
    const put = (revision: number, g = goals) =>
      nurse.req('PUT', `/api/desk/care-plans/${draft.id}`, {
        revision,
        goals: g,
        interventions: draft.body.interventions,
      });
    expect((await put(0)).json()).toMatchObject({ revision: 1, body: { goals } });
    expect((await put(0)).statusCode).toBe(409); // a stale editor can't overwrite it either
    expect((await sign(doctor, 0)).json()).toMatchObject({ error: 'changed' });
    expect((await put(1, ['x'.repeat(301)])).statusCode).toBe(400);

    expect((await sign(doctor, 1)).json()).toMatchObject({ status: 'signed', revision: 1, body: { goals } });
    expect((await put(1)).statusCode).toBe(409); // signed plans never change
  });

  it('builds the month, exports evidence safely, marks billed, and reports revenue', async () => {
    expect((await desk.req('POST', '/api/desk/apcm/build', { month: '2026-11' })).json()).toEqual({
      patients: 1,
      ready: 1,
    });
    const list = (await desk.req('GET', '/api/desk/apcm?month=2026-11')).json();
    expect(list[0]).toMatchObject({
      hcpcs: 'G0557',
      status: 'ready',
      rateCents: 5378,
      chronicConditions: ['diabetes', 'heart_failure'],
    });

    const csv = await desk.req('GET', '/api/desk/apcm/export?month=2026-11');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain(`"'=HYPERLINK(""http://x"")"`); // the formula is neutralized
    expect(csv.body).toContain('daily_call@2026-11-04');
    expect((await nurse.req('GET', '/api/desk/apcm/export?month=2026-11')).statusCode).toBe(403);

    expect((await desk.req('POST', `/api/desk/apcm/${list[0].id}/billed`)).statusCode).toBe(204);
    expect((await desk.req('POST', `/api/desk/apcm/${list[0].id}/billed`)).statusCode).toBe(404);
    const report = (await doctor.req('GET', '/api/desk/report?month=2026-11')).json();
    expect(report).toMatchObject({ enrolled: 1, billed: 1, apcmRevenueCents: 5378, callsCompleted: 1 });
  });

  it('the queue puts an emergency before a care plan, with the caller’s words, for the practice only', async () => {
    await ownerDb().insert(schema.nurseFlag).values({
      patientId,
      channel: 'voice',
      class: 'emergency',
      matchedRule: 'en.emergency.chest',
      excerpt: 'chest pain',
      urgency: 1,
    });
    await nurse.req('POST', `/api/desk/patients/${patientId}/care-plan/draft`);
    const q = (await doctor.req('GET', '/api/desk/queue')).json();
    expect(q.map((i: { kind: string }) => i.kind)).toEqual(['flag', 'care_plan']);
    expect(q[0]).toMatchObject({ flagClass: 'emergency', excerpt: 'chest pain', urgency: 1 });
    const other = await staff('physician', (await makePracticeAndHousehold()).practiceId);
    expect((await other.req('GET', '/api/desk/queue')).json()).toEqual([]);
  });

  it('Gene-to-Pill: a PGx result makes a doctor-only queue item; nurses and families never see it', async () => {
    const db = ownerDb();
    const [m] = await db
      .insert(schema.medication)
      .values({ patientId, rxcui: '309362', displayName: 'clopidogrel 75 MG Oral Tablet', source: 'claims' })
      .returning();
    await db.insert(schema.fill).values({
      patientId,
      medicationId: m!.id,
      ndc: '99000000701',
      rxcui: '309362',
      fillDate: '2026-11-01',
      daysSupply: 30,
      quantity: '30',
      source: 'manual',
      sourceRef: `pgx-${patientId}`,
    });
    const r = await doctor.req('POST', `/api/desk/patients/${patientId}/pgx`, {
      gene: 'CYP2C19',
      diplotype: '*2/*2',
      phenotype: 'Poor Metabolizer',
      lab: 'Demo Lab',
      reportedAt: '2026-11-10',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(
      (
        await nurse.req('POST', `/api/desk/patients/${patientId}/pgx`, {
          gene: 'CYP2C19',
          diplotype: '*1/*1',
          phenotype: 'Normal Metabolizer',
          lab: 'Demo Lab',
          reportedAt: '2026-11-10',
        })
      ).statusCode,
    ).toBe(403);
    await withScope('worker', systemScope('t'), (w) =>
      runEngine(w, { today: '2026-11-15', patientIds: [patientId] }),
    );
    const q = (await doctor.req('GET', '/api/desk/queue')).json();
    expect(q.find((i: { kind: string }) => i.kind === 'gene_drug')).toMatchObject({
      gene: 'CYP2C19',
      phenotype: 'Poor Metabolizer',
      drug: 'clopidogrel 75 MG Oral Tablet',
    });
    expect(
      (await nurse.req('GET', '/api/desk/queue'))
        .json()
        .some((i: { kind: string }) => i.kind === 'gene_drug'),
    ).toBe(false);
  });

  it('rejects malformed months', async () => {
    expect((await desk.req('GET', '/api/desk/apcm?month=2026-13')).statusCode).toBe(400);
  });
});
