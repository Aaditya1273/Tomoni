import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, ownerDb, schema, withScope } from '../src';
import { buildWorld, pgError } from './fixtures';

let w: Awaited<ReturnType<typeof buildWorld>>;

beforeAll(async () => {
  w = await buildWorld();
  const db = ownerDb();
  for (const p of [w.raj, w.lata]) {
    const [c] = await db
      .insert(schema.call)
      .values({
        patientId: p.id,
        channel: 'simulator',
        locale: 'en',
        scriptVersion: 'v1',
        step: 'ended',
        disclosurePlayed: true,
        outcome: 'completed',
      })
      .returning();
    await db.insert(schema.nurseFlag).values({
      patientId: p.id,
      callId: c!.id,
      channel: 'simulator',
      class: 'symptom',
      matchedRule: 'r',
      excerpt: 'dizzy',
      urgency: 2,
    });
    await db.insert(schema.action).values({
      patientId: p.id,
      skill: 'checkRefillStatus',
      skillVersion: 1,
      inputs: { rxcui: '1' },
      approvalClass: 'none',
      idempotencyKey: `k-${p.id}`,
    });
  }
});
afterAll(closePools);

const count = (u: string, t: typeof schema.call | typeof schema.nurseFlag | typeof schema.action) =>
  withScope('app', w.scope(u as never), async (db) => (await db.select().from(t)).length);

describe('SECURITY S1 on calls, nurse flags and actions', () => {
  it.each([
    ['asha', 1],
    ['raj', 1],
    ['drrao', 1],
    ['nurseB', 1],
    ['opsA', 0],
    ['opsB', 1],
    ['admin', 2],
    ['sponsor', 0],
  ])('%s sees %i of each', async (u, n) => {
    expect(await count(u, schema.call)).toBe(n);
    expect(await count(u, schema.nurseFlag)).toBe(n);
    expect(await count(u, schema.action)).toBe(n);
  });

  it('rule 2.10 in the schema: no conversation step without the disclosure', async () => {
    expect(
      await pgError(
        ownerDb().insert(schema.call).values({
          patientId: w.raj.id,
          channel: 'voice',
          locale: 'en',
          scriptVersion: 'v1',
          step: 'wellbeing',
        }),
      ),
    ).toMatch(/check constraint/);
  });

  it('rule 2.3 in the schema: nothing succeeds without a verification', async () => {
    expect(
      await pgError(
        ownerDb().insert(schema.action).values({
          patientId: w.raj.id,
          skill: 'checkRefillStatus',
          skillVersion: 1,
          inputs: {},
          approvalClass: 'none',
          state: 'succeeded',
          idempotencyKey: 'x',
        }),
      ),
    ).toMatch(/check constraint/);
  });

  it('families cannot create actions or flags; they only decide through approvals', async () => {
    expect(
      await pgError(
        withScope('app', w.scope('asha'), (db) =>
          db.insert(schema.action).values({
            patientId: w.raj.id,
            skill: 's',
            skillVersion: 1,
            inputs: {},
            approvalClass: 'none',
            idempotencyKey: 'y',
          }),
        ),
      ),
    ).toMatch(/permission denied|row-level security/);
    expect(
      await pgError(
        withScope('app', w.scope('asha'), (db) =>
          db.insert(schema.nurseFlag).values({
            patientId: w.raj.id,
            channel: 'family_app',
            class: 'symptom',
            matchedRule: 'r',
            excerpt: 'x',
            urgency: 2,
          }),
        ),
      ),
    ).toMatch(/row-level security/);
  });
});
