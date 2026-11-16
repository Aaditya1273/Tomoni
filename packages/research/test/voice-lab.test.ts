import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemScope } from '@tomoni/core';
import { closePools, ownerDb, pool, schema, sql, withScope } from '@tomoni/db';
import {
  extractPending,
  isPcm16Wav,
  labelOutcomes,
  MockFeatureService,
  storeAudio,
  type FeatureService,
} from '../src';

/** 16-bit PCM mono WAV, a tone, as Twilio returns it. */
const wav = (ms = 1000, rate = 8000) => {
  const n = (rate * ms) / 1000;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34); // bits
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i / 5)), 44 + i * 2);
  return b;
};
const objects = new Map<string, Buffer>();
const store = {
  put: async (k: string, v: Buffer) => void objects.set(k, v),
  get: async (k: string) => objects.get(k) ?? null,
};

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

  it('stores the speech audio once, under the pseudonym, and only real 16-bit WAV', async () => {
    const { rows } = await db.execute<{ id: string; research_pid: string }>(
      sql`SELECT id, research_pid FROM research.speech_sample WHERE features IS NULL`,
    );
    const s = rows[0]!;
    expect(isPcm16Wav(Buffer.from('<svg onload=alert(1)>'))).toBe(false);
    const eightBit = wav();
    eightBit.writeUInt16LE(8, 34);
    await expect(worker((w) => storeAudio(w, store, s.id, eightBit))).rejects.toThrow(/16-bit PCM/);
    expect(await worker((w) => storeAudio(w, store, s.id, wav()))).toBe(true);
    expect(await worker((w) => storeAudio(w, store, s.id, wav()))).toBe(false);
    expect([...objects.keys()]).toEqual([`research/audio/${s.research_pid}/${s.id}.wav`]);
    expect([...objects.keys()][0]).not.toContain(patientId);
  });

  it('the worker extracts features and labels hospital stays from claims', async () => {
    await db.insert(schema.claim).values({
      patientId,
      kind: 'inpatient',
      startDate: '2026-11-20',
      source: 'mock',
      sourceRef: `vl-${crypto.randomUUID()}`,
    });
    const heard: (number | null)[] = [];
    const spy: FeatureService = {
      mode: 'mock',
      extract: (i) => (heard.push(i.wav?.length ?? null), new MockFeatureService().extract(i)),
    };
    expect(await worker((w) => extractPending(w, spy, store))).toEqual({
      pending: 1,
      extracted: 1,
    });
    expect(heard).toEqual([wav().length]); // the stored audio, decrypted, goes to the service
    const claim = (o: Partial<typeof schema.claim.$inferInsert>) =>
      db.insert(schema.claim).values({
        patientId,
        kind: 'carrier',
        startDate: '2099-01-01',
        source: 'mock',
        sourceRef: `vl-${crypto.randomUUID()}`,
        ...o,
      });
    await claim({ startDate: '2000-01-01', dxCodes: ['E11.9'] }); // diabetes, before the study
    await claim({ dxCodes: ['E11.65', 'I48.91'] }); // E11 is not new; I48 (atrial fibrillation) is
    await claim({ startDate: '2099-02-01', dxCodes: ['I48.0'] }); // I48 again: not new any more
    await claim({ kind: 'outpatient', edVisit: true, dxCodes: ['E11.9'] });
    expect(await worker(labelOutcomes)).toEqual({ labelled: 3 }); // stay, ED visit, one new dx
    const kinds = await db.execute<{ kind: string; start_date: string }>(
      sql`SELECT kind, start_date::text FROM research.outcome_label ORDER BY kind`,
    );
    expect(kinds.rows).toEqual([
      { kind: 'ed_visit', start_date: '2099-01-01' },
      { kind: 'inpatient_stay', start_date: '2026-11-20' },
      { kind: 'new_dx', start_date: '2099-01-01' },
    ]);
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
    const [any] = (await db.execute<{ id: string }>(sql`SELECT id FROM research.speech_sample`)).rows;
    await db.execute(sql`UPDATE research.speech_sample SET audio_ref = NULL WHERE id = ${any!.id}`);
    expect(await worker((w) => storeAudio(w, store, any!.id, wav()))).toBe(false); // nothing stored
    expect(await record(await newCall())).toBeNull();
  });
});
