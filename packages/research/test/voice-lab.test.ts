import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemScope } from '@tomoni/core';
import { closePools, ownerDb, pool, schema, sql, withScope } from '@tomoni/db';
import { extractPending, labelOutcomes, MockFeatureService } from '../src';

const db = ownerDb();
let patientId = '';
let callId = '';
let consentId = '';
const worker = <T>(fn: Parameters<typeof withScope<T>>[2]) => withScope('worker', systemScope('test'), fn);
const record = (call = callId) =>
  db
    .execute<{ id: string | null }>(
      sql`SELECT research.record_speech_sample(${call}, 'describe_yesterday', 1, 21000) AS id`,
    )
    .then((r) => r.rows[0]!.id);
const newCall = async () => {
  const [c] = await db
    .insert(schema.call)
    .values({ patientId, channel: 'simulator', locale: 'en', scriptVersion: 't', startedAt: new Date() })
    .returning();
  return c!.id;
};

beforeAll(async () => {
  const [pr] = await db.insert(schema.practice).values({ name: 'VL', tz: 'America/New_York' }).returning();
  const [h] = await db.insert(schema.household).values({ displayName: 'H', primaryLocale: 'en' }).returning();
  const [p] = await db
    .insert(schema.patient)
    .values({
      practiceId: pr!.id,
      householdId: h!.id,
      name: 'P',
      dob: '1950-01-01',
      birthYear: 1950,
      state: 'NJ',
      locale: 'en',
      tz: 'America/New_York',
      medicareType: 'original',
    })
    .returning();
  patientId = p!.id;
  const { rows } = await db.execute<{
    id: string;
  }>(sql`INSERT INTO research.protocol (code, version, title, irb_name,
    irb_approval_ref, approved_at, expires_at, status, plain_summary) VALUES ('VL', 1, 'Voice Lab', 'IRB', 'IRB-1',
    '2026-01-01', '2099-01-01', 'approved', '{"en":"…"}') RETURNING id`);
  const protocolId = rows[0]!.id;
  const c = await db.execute<{
    id: string;
  }>(sql`INSERT INTO research.research_consent (patient_id, protocol_id,
    given_by_kind, hipaa_authorization_ref, recording_permission, scope_speech_task, scope_trial_matching,
    scope_pgx_research, method, locale) VALUES (${patientId}, ${protocolId}, 'patient', 'H', true, false, true, false,
    'e_sign', 'en') RETURNING id`);
  consentId = c.rows[0]!.id;
  callId = await newCall();
});
afterAll(closePools);

describe('Voice Lab (rules 2.5, 2.8)', () => {
  it('no speech-task scope: nothing is recorded', async () => {
    expect(await record()).toBeNull();
  });

  it('with the scope, a sample is recorded under the pseudonym, once a day', async () => {
    await db.execute(sql`UPDATE research.research_consent SET withdrawn_at = now() WHERE id = ${consentId}`);
    const { rows } = await db.execute<{
      id: string;
    }>(sql`INSERT INTO research.research_consent (patient_id, protocol_id,
      given_by_kind, hipaa_authorization_ref, recording_permission, scope_speech_task, scope_trial_matching,
      scope_pgx_research, method, locale) SELECT patient_id, protocol_id, 'patient', 'H', true, true, false, false,
      'e_sign', 'en' FROM research.research_consent WHERE id = ${consentId} RETURNING id`);
    consentId = rows[0]!.id;
    const id = await record();
    expect(id).toBeTruthy();
    expect(await record()).toBeNull(); // same task, same day
    const [s] = (await db.execute(sql`SELECT * FROM research.speech_sample WHERE id = ${id}`)).rows;
    expect(s).not.toHaveProperty('patient_id');
    expect(s).toMatchObject({ consent_id: consentId, duration_ms: 21000, features: null });
  });

  it('needs a live call: an ended call records nothing', async () => {
    const ended = await newCall();
    await db.execute(sql`UPDATE care.call SET ended_at = now() WHERE id = ${ended}`);
    expect(await record(ended)).toBeNull();
    expect(await record(crypto.randomUUID())).toBeNull();
  });

  it('care, family and sponsor roles cannot read samples or labels at all', async () => {
    for (const role of ['app', 'sponsor'] as const)
      for (const t of ['speech_sample', 'outcome_label'])
        await expect(pool(role).query(`SELECT 1 FROM research.${t}`)).rejects.toThrow(/permission denied/);
  });

  it('the worker extracts features and labels hospital stays from claims', async () => {
    await db.insert(schema.claim).values({
      patientId,
      kind: 'inpatient',
      startDate: '2026-11-20',
      source: 'mock',
      sourceRef: `vl-${crypto.randomUUID()}`,
    });
    expect(await worker((w) => extractPending(w, new MockFeatureService()))).toEqual({
      pending: 1,
      extracted: 1,
    });
    expect(await worker(labelOutcomes)).toEqual({ labelled: 1 });
    expect(await worker(labelOutcomes)).toEqual({ labelled: 0 });
    const { rows } = await db.execute<{ feature_version: string }>(
      sql`SELECT feature_version FROM research.speech_sample`,
    );
    expect(rows[0]!.feature_version).toBe('mock-0');
  });

  it('withdrawal hides everything from the worker on the next statement', async () => {
    await db.execute(sql`UPDATE research.research_consent SET withdrawn_at = now() WHERE id = ${consentId}`);
    const seen = await worker(async (w) => ({
      s: (await w.execute(sql`SELECT count(*)::int AS n FROM research.speech_sample`)).rows[0],
      o: (await w.execute(sql`SELECT count(*)::int AS n FROM research.outcome_label`)).rows[0],
    }));
    expect(seen).toEqual({ s: { n: 0 }, o: { n: 0 } });
    expect(await record(await newCall())).toBeNull();
  });
});
