import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { scopeFromGrants, type RoleGrant } from '@tomoni/core';
import { closePools, ownerDb, schema, withScope } from '@tomoni/db';
import {
  buildApcmMonth,
  chronicConditions,
  draftCarePlan,
  evaluateMonth,
  hcpcsFor,
  signCarePlan,
} from '../src';

describe('APCM rules', () => {
  it('groups chronic conditions from ICD-10 codes', () => {
    expect(chronicConditions(['E11.9', 'E11.65', 'I10', 'Z00.00', 'J44.9']).map((c) => c.code)).toEqual([
      'diabetes',
      'hypertension',
      'copd',
    ]);
  });
  it('picks the code from the count and QMB status', () => {
    expect([hcpcsFor(0, false), hcpcsFor(1, true), hcpcsFor(2, false), hcpcsFor(3, true)]).toEqual([
      'G0556',
      'G0556',
      'G0557',
      'G0558',
    ]);
  });
  it('excludes a month with the reason when any evidence is missing', () => {
    const s = [{ kind: 'daily_call', at: '2026-11-03', ref: 'c1' }];
    expect(evaluateMonth({ consentId: null, carePlanId: 'p', services: s }).exclusionReason).toMatch(
      /consent/,
    );
    expect(evaluateMonth({ consentId: 'c', carePlanId: null, services: s }).exclusionReason).toMatch(
      /care plan/,
    );
    expect(evaluateMonth({ consentId: 'c', carePlanId: 'p', services: [] }).exclusionReason).toMatch(
      /no services/,
    );
    expect(evaluateMonth({ consentId: 'c', carePlanId: 'p', services: s })).toEqual({
      status: 'ready',
      exclusionReason: null,
    });
  });
});

const db = ownerDb();
let practiceId = '';
let patientId = '';
const users: Record<string, string> = {};
const g = (role: RoleGrant['role']): RoleGrant => ({
  role,
  practiceId,
  householdId: null,
  patientId: null,
  sponsorId: null,
});
const as = (u: 'doc' | 'nurse') => scopeFromGrants(users[u]!, [g(u === 'doc' ? 'physician' : 'nurse')]);

beforeAll(async () => {
  const [pr] = await db
    .insert(schema.practice)
    .values({ name: 'Rao Family Medicine', tz: 'America/New_York' })
    .returning();
  practiceId = pr!.id;
  const [h] = await db
    .insert(schema.household)
    .values({ displayName: 'Patel', primaryLocale: 'gu' })
    .returning();
  const [p] = await db
    .insert(schema.patient)
    .values({
      practiceId,
      householdId: h!.id,
      name: 'Raj',
      dob: '1953-01-01',
      birthYear: 1953,
      state: 'NJ',
      locale: 'gu',
      tz: 'America/New_York',
      medicareType: 'original',
    })
    .returning();
  patientId = p!.id;
  await db
    .insert(schema.familyMember)
    .values({ householdId: h!.id, displayName: 'Asha Patel', relationship: 'daughter' });
  await db.insert(schema.careConsent).values({
    patientId,
    practiceId,
    givenByKind: 'patient',
    method: 'verbal_recorded',
    copayDisclosed: true,
    givenAt: new Date('2026-10-01'),
  });
  await db.insert(schema.claim).values({
    patientId,
    kind: 'carrier',
    startDate: '2026-09-01',
    dxCodes: ['E11.9', 'I10'],
    source: 'manual',
    sourceRef: 'c1',
  });
  await db.insert(schema.medication).values({
    patientId,
    rxcui: '861007',
    displayName: 'metformin hydrochloride 500 MG Oral Tablet',
    source: 'claims',
  });
  await db.insert(schema.call).values({
    patientId,
    channel: 'simulator',
    locale: 'gu',
    scriptVersion: 'v1',
    step: 'ended',
    disclosurePlayed: true,
    outcome: 'completed',
    startedAt: new Date('2026-11-03T15:00:00Z'),
  });
  for (const [u, role] of [
    ['doc', 'physician'],
    ['nurse', 'nurse'],
  ] as const) {
    const [row] = await db
      .insert(schema.userAccount)
      .values({ email: `${u}@care.test`, displayName: u })
      .returning();
    users[u] = row!.id;
    await db.insert(schema.roleGrant).values({ userId: row!.id, role, practiceId });
  }
});
afterAll(closePools);

describe('care plans and APCM months', () => {
  it('without a signed care plan the month is excluded, with the reason', async () => {
    const r = await withScope('app', as('nurse'), (d) => buildApcmMonth(d, [practiceId], '2026-11'));
    expect(r).toEqual({ month: '2026-11-01', patients: 1, ready: 0 });
    const [rec] = await db.select().from(schema.apcmMonthRecord);
    expect(rec).toMatchObject({ status: 'excluded', exclusionReason: 'no signed care plan', hcpcs: 'G0557' });
  });

  it('the agent drafts from claims, medicines and family; only the physician can sign', async () => {
    const plan = await withScope('app', as('nurse'), (d) => draftCarePlan(d, patientId, 'agent'));
    expect(plan.body.problems.map((p) => p.code)).toEqual(['diabetes', 'hypertension']);
    expect(plan.body.medications).toEqual(['metformin hydrochloride 500 MG Oral Tablet']);
    expect(plan.body.contacts).toEqual([{ name: 'Asha Patel', role: 'daughter' }]);
    await expect(
      withScope('app', as('nurse'), (d) => signCarePlan(d, plan.id, users.nurse!, 0)),
    ).rejects.toThrow();
    const signed = await withScope('app', as('doc'), (d) => signCarePlan(d, plan.id, users.doc!, 0));
    expect(signed).toMatchObject({ status: 'signed', version: 1 });
  });

  it('a signed plan never changes; a new version supersedes it', async () => {
    const [signed] = await db.select().from(schema.carePlan).where(eq(schema.carePlan.status, 'signed'));
    await expect(
      db
        .update(schema.carePlan)
        .set({ body: { ...signed!.body, goals: ['edited'] } })
        .where(eq(schema.carePlan.id, signed!.id)),
    ).rejects.toThrow();
    const v2 = await withScope('app', as('nurse'), (d) => draftCarePlan(d, patientId, 'agent'));
    await withScope('app', as('doc'), (d) => signCarePlan(d, v2.id, users.doc!, 0));
    const plans = await db.select().from(schema.carePlan).orderBy(schema.carePlan.version);
    expect(plans.map((p) => [p.version, p.status])).toEqual([
      [1, 'superseded'],
      [2, 'signed'],
    ]);
  });

  it('with consent, a signed plan and services, the month is ready with its evidence; billed months are frozen', async () => {
    await withScope('app', as('nurse'), (d) => buildApcmMonth(d, [practiceId], '2026-11'));
    const [rec] = await db.select().from(schema.apcmMonthRecord);
    expect(rec).toMatchObject({
      status: 'ready',
      hcpcs: 'G0557',
      chronicConditions: ['diabetes', 'hypertension'],
    });
    expect(rec!.services.map((s) => s.kind)).toEqual(['daily_call', 'care_plan_signed', 'care_plan_signed']);
    await db.execute(sql`UPDATE care.apcm_month_record SET status = 'billed', billed_at = now()`);
    await withScope('app', as('nurse'), (d) => buildApcmMonth(d, [practiceId], '2026-11'));
    expect((await db.select().from(schema.apcmMonthRecord))[0]!.status).toBe('billed');
    await expect(db.execute(sql`UPDATE care.apcm_month_record SET hcpcs = 'G0558'`)).rejects.toThrow();
  });
});
