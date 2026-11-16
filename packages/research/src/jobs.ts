/**
 * The nightly Voice Lab jobs, run by the worker role. Every query goes through RLS, which only
 * shows rows whose pseudonym has active speech-task consent: a withdrawal stops both jobs.
 */
import { sql } from 'drizzle-orm';
import type { Db, ObjectStore } from '@tomoni/db';
import { unseal } from './brand';
import { isPcm16Wav, type FeatureService } from './features';

/**
 * Stores one speech task's audio under the pseudonym, encrypted, in the research bucket (D-032).
 * False when the sample is not visible (consent withdrawn) or already has audio: nothing stored.
 */
export async function storeAudio(db: Db, store: ObjectStore, sampleId: string, wav: Uint8Array) {
  if (!isPcm16Wav(wav)) throw new Error('not 16-bit PCM WAV');
  const { rows } = await db.execute<{ pid: string }>(sql`
    SELECT research_pid AS pid FROM research.speech_sample WHERE id = ${sampleId} AND audio_ref IS NULL FOR UPDATE`);
  if (!rows[0]) return false;
  const key = `research/audio/${rows[0].pid}/${sampleId}.wav`;
  await store.put(key, Buffer.from(wav));
  await db.execute(sql`UPDATE research.speech_sample SET audio_ref = ${key} WHERE id = ${sampleId}`);
  return true;
}

/** Extract features for samples that have none yet. */
export async function extractPending(db: Db, svc: FeatureService, store: ObjectStore, limit = 500) {
  const { rows } = await db.execute<{ id: string; duration_ms: number; audio_ref: string | null }>(sql`
    SELECT id, duration_ms, audio_ref FROM research.speech_sample WHERE features IS NULL
     ORDER BY recorded_at LIMIT ${limit}`);
  let done = 0;
  for (const s of rows) {
    const wav = s.audio_ref ? await store.get(s.audio_ref) : null;
    const f = await svc.extract({ durationMs: s.duration_ms, wav });
    if (!f) continue;
    const v = unseal(f);
    await db.execute(sql`UPDATE research.speech_sample
      SET features = ${JSON.stringify(v)}::jsonb, feature_version = ${v.featureVersion} WHERE id = ${s.id}`);
    done++;
  }
  return { pending: rows.length, extracted: done };
}

/** Outcome labels from claims (hospital stays), for people in the speech dataset only. */
export async function labelOutcomes(db: Db) {
  const { rows } = await db.execute<{ n: number }>(sql`
    WITH ins AS (
      INSERT INTO research.outcome_label (research_pid, kind, start_date, source_claim_id)
      SELECT r.research_pid, 'inpatient_stay', c.start_date, c.id
        FROM care.claim c JOIN research.research_id r ON r.patient_id = c.patient_id
       WHERE c.kind = 'inpatient'
         AND EXISTS (SELECT 1 FROM research.speech_sample s WHERE s.research_pid = r.research_pid)
      ON CONFLICT DO NOTHING RETURNING 1)
    SELECT count(*)::int AS n FROM ins`);
  return { labelled: rows[0]?.n ?? 0 };
}
