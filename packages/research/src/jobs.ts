/**
 * The nightly Voice Lab jobs, run by the worker role. Every query goes through RLS, which only
 * shows rows whose pseudonym has active speech-task consent: a withdrawal stops both jobs.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '@tomoni/db';
import { unseal } from './brand';
import type { FeatureService } from './features';

/** Extract features for samples that have none yet. */
export async function extractPending(db: Db, svc: FeatureService, limit = 500) {
  const { rows } = await db.execute<{ id: string; duration_ms: number }>(sql`
    SELECT id, duration_ms FROM research.speech_sample WHERE features IS NULL ORDER BY recorded_at LIMIT ${limit}`);
  let done = 0;
  for (const s of rows) {
    // ponytail: audio capture lands with the Twilio <Record> step; until then wav is null.
    const f = await svc.extract({ durationMs: s.duration_ms, wav: null });
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
