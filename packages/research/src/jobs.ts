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

/**
 * Outcome labels from claims, for people in the speech dataset only: hospital stays, emergency
 * visits, and new diagnoses. A new diagnosis is an ICD-10 category (first three characters) that
 * first appears in a claim dated after the person's first speech sample, labelled at that claim.
 */
export async function labelOutcomes(db: Db) {
  const { rows } = await db.execute<{ n: number }>(sql`
    WITH people AS (
      SELECT r.research_pid, r.patient_id, min(s.recorded_on) AS baseline
        FROM research.research_id r JOIN research.speech_sample s ON s.research_pid = r.research_pid
       GROUP BY r.research_pid, r.patient_id),
    events AS (
      SELECT p.research_pid, 'inpatient_stay' AS kind, c.start_date, c.id
        FROM care.claim c JOIN people p ON p.patient_id = c.patient_id WHERE c.kind = 'inpatient'
      UNION ALL
      SELECT p.research_pid, 'ed_visit', c.start_date, c.id
        FROM care.claim c JOIN people p ON p.patient_id = c.patient_id WHERE c.ed_visit
      UNION ALL
      SELECT DISTINCT p.research_pid, 'new_dx', c.start_date, c.id
        FROM care.claim c JOIN people p ON p.patient_id = c.patient_id, unnest(c.dx_codes) d(code)
       WHERE c.start_date > p.baseline
         AND NOT EXISTS (SELECT 1 FROM care.claim e, unnest(e.dx_codes) ed(code)
                          WHERE e.patient_id = c.patient_id AND e.start_date < c.start_date
                            AND left(ed.code, 3) = left(d.code, 3))),
    ins AS (
      INSERT INTO research.outcome_label (research_pid, kind, start_date, source_claim_id)
      SELECT research_pid, kind, start_date, id FROM events
      ON CONFLICT DO NOTHING RETURNING 1)
    SELECT count(*)::int AS n FROM ins`);
  return { labelled: rows[0]?.n ?? 0 };
}
