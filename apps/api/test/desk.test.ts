import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, ownerDb, schema } from '@tomoni/db';
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
    expect((await nurse.req('POST', `/api/desk/care-plans/${draft.id}/sign`)).statusCode).toBe(403);
    expect((await doctor.req('POST', `/api/desk/care-plans/${draft.id}/sign`)).json()).toMatchObject({
      status: 'signed',
    });
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

  it('rejects malformed months', async () => {
    expect((await desk.req('GET', '/api/desk/apcm?month=2026-13')).statusCode).toBe(400);
  });
});
