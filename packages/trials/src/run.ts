/** Matching against the database, as the worker. Re-running is idempotent (UNIQUE(trial, pseudonym)). */
import { sql } from 'drizzle-orm';
import type { Db } from '@tomoni/db';
import { chronicConditions } from '@tomoni/care';
import { matches, type Candidate, type Criterion } from './match';

export async function matchTrials(db: Db, today: string) {
  const { rows: trials } = await db.execute<{ id: string; criteria: Criterion[] }>(sql`
    SELECT t.id, coalesce(jsonb_agg(jsonb_build_object('field', c.field, 'value', c.value))
                          FILTER (WHERE c.id IS NOT NULL), '[]') AS criteria
      FROM research.trial t LEFT JOIN research.trial_criterion c ON c.trial_id = t.id
     WHERE t.status = 'recruiting' GROUP BY t.id`);
  if (!trials.length) return { trials: 0, created: 0 };
  // Only consented registry members are candidates.
  const { rows } = await db.execute<{
    patient_id: string;
    research_pid: string;
    birth_year: number;
    locale: string;
    dx: string[] | null;
    rx: string[] | null;
    inpatient_days: number | null;
  }>(sql`
    SELECT p.id AS patient_id, r.research_pid, p.birth_year, p.locale,
           (SELECT array_agg(DISTINCT d) FROM care.claim c, unnest(c.dx_codes) d
             WHERE c.patient_id = p.id AND c.start_date > ${today}::date - 730) AS dx,
           (SELECT array_agg(DISTINCT f.rxcui) FROM care.fill f
             WHERE f.patient_id = p.id AND f.rxcui IS NOT NULL AND f.fill_date > ${today}::date - 120) AS rx,
           (SELECT ${today}::date - max(start_date) FROM care.claim c WHERE c.patient_id = p.id AND c.kind = 'inpatient') AS inpatient_days
      FROM care.patient p JOIN research.research_id r ON r.patient_id = p.id
     WHERE p.status = 'active' AND research.has_active_consent(p.id, 'trial_matching')`);
  const year = Number(today.slice(0, 4));
  let created = 0;
  for (const r of rows) {
    const c: Candidate = {
      patientId: r.patient_id,
      age: year - r.birth_year,
      language: r.locale,
      conditions: chronicConditions(r.dx ?? []).map((x) => x.code),
      rxcuis: r.rx ?? [],
      lastInpatientDaysAgo: r.inpatient_days,
    };
    for (const t of trials) {
      if (!matches(c, t.criteria)) continue;
      const res =
        await db.execute(sql`INSERT INTO research.trial_match (trial_id, research_pid) VALUES (${t.id}, ${r.research_pid})
                                        ON CONFLICT (trial_id, research_pid) DO NOTHING`);
      created += res.rowCount ?? 0;
    }
  }
  return { trials: trials.length, candidates: rows.length, created };
}
