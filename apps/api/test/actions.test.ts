import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { closePools, env, ownerDb, schema } from '@tomoni/db';
import { buildServer } from '../src/server';
import { Client, makePracticeAndHousehold, makeUser, ORIGIN, totp } from './helpers';

let app: Awaited<ReturnType<typeof buildServer>>;
let ids: Awaited<ReturnType<typeof makePracticeAndHousehold>>;
let patientId = '';
let asha: Client;
let doctor: Client;
const redis = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue('tomoni', { connection: redis, prefix: 'test-api' });

async function mfa(c: Client) {
  const { secret } = (await c.req('POST', '/api/auth/mfa/enroll')).json();
  await c.req('POST', '/api/auth/mfa/enroll/confirm', { code: await totp(secret) });
  return c;
}
async function warning(type: string, rxcui: string | null, evidence: Record<string, unknown> = {}) {
  const [w] = await ownerDb()
    .insert(schema.warning)
    .values({
      patientId,
      type: type as never,
      rxcui,
      daysUntilProblem: 9,
      problemDate: '2026-11-24',
      accessStatus: 'red',
      sourceKind: 'fill',
      sourceRef: crypto.randomUUID(),
      sourceDate: '2026-10-25',
      evidence: { drug: 'clopidogrel 75 MG Oral Tablet', ...evidence },
      dedupeKey: crypto.randomUUID(),
    })
    .returning();
  return w!.id;
}

beforeAll(async () => {
  app = await buildServer({ config: { allowedOrigins: [ORIGIN], docs: false } });
  await queue.obliterate({ force: true });
  ids = await makePracticeAndHousehold();
  const [p] = await ownerDb()
    .insert(schema.patient)
    .values({
      practiceId: ids.practiceId,
      householdId: ids.householdId,
      name: 'Raj Patel',
      dob: '1953-01-01',
      birthYear: 1953,
      state: 'NJ',
      locale: 'en',
      tz: 'America/New_York',
      medicareType: 'original',
    })
    .returning();
  patientId = p!.id;
  asha = new Client(app);
  await asha.login((await makeUser('family_member', { householdId: ids.householdId })).email);
  doctor = new Client(app);
  await doctor.login((await makeUser('physician', { practiceId: ids.practiceId })).email);
  await mfa(doctor);
});
afterAll(async () => {
  await queue.close();
  redis.disconnect();
  await app.close();
  await closePools();
});

describe('agent actions through the API', () => {
  it('a family asks for help: a no-approval skill is queued to run at once', async () => {
    const w = await warning('late_refill', '309362');
    expect((await asha.req('POST', `/api/warnings/${w}/help`)).json()).toEqual({ proposed: 1 });
    const jobs = await queue.getJobs(['waiting', 'delayed']);
    expect(jobs.filter((j) => j.name === 'action.run')).toHaveLength(1);
    const card = (await asha.req('GET', '/api/family/card')).json();
    expect(card.patients[0].actions[0]).toMatchObject({
      warningId: w,
      skill: 'checkRefillStatus',
      state: 'approved',
    });
  });

  it('a renewal shows on the desk; only the physician signs, then it is queued', async () => {
    const w = await warning('run_out', '309362');
    await asha.req('POST', `/api/warnings/${w}/help`);
    const pending = (await doctor.req('GET', '/api/desk/approvals')).json();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      skill: 'draftRenewalForDoctor',
      patientName: 'Raj Patel',
      facts: { drug: 'clopidogrel 75 MG Oral Tablet' },
    });
    expect(
      (await asha.req('POST', `/api/actions/${pending[0].id}/decision`, { decision: 'approve' })).statusCode,
    ).toBe(403);
    expect(
      (await doctor.req('POST', `/api/actions/${pending[0].id}/decision`, { decision: 'approve' }))
        .statusCode,
    ).toBe(204);
    expect((await doctor.req('GET', '/api/desk/approvals')).json()).toEqual([]);
    expect(
      (await doctor.req('POST', `/api/actions/${pending[0].id}/decision`, { decision: 'approve' }))
        .statusCode,
    ).toBe(403);
  });

  it('another household cannot ask for help with a warning it cannot see', async () => {
    const w = await warning('late_refill', '861007');
    const other = await makePracticeAndHousehold();
    const stranger = new Client(app);
    await stranger.login((await makeUser('family_member', { householdId: other.householdId })).email);
    expect((await stranger.req('POST', `/api/warnings/${w}/help`)).statusCode).toBe(404);
  });

  it('ops sees handed-over actions only where offshore access is on (D-008)', async () => {
    await ownerDb().update(schema.action).set({ state: 'handoff', handoffReason: 'portal down' });
    const ops = new Client(app);
    await ops.login((await makeUser('ops_agent', { practiceId: ids.practiceId })).email);
    await mfa(ops);
    expect((await ops.req('GET', '/api/ops/handoffs')).json()).toEqual([]); // practice has offshore access off
    await ownerDb().update(schema.practice).set({ offshoreOpsAccess: true });
    const list = (await ops.req('GET', '/api/ops/handoffs')).json();
    expect(list.length).toBeGreaterThan(0);
    expect((await ops.req('POST', `/api/ops/actions/${list[0].id}/retry`)).statusCode).toBe(204);
    await ownerDb().update(schema.practice).set({ offshoreOpsAccess: false });
  });
});
