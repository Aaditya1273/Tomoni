/**
 * Runs the warning engine against the database: load facts, detect, then upsert open warnings
 * and resolve the ones the facts no longer support. Set-based so 10,000 patients stay well inside
 * the §6 budget (5 minutes on a laptop).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '@tomoni/db';
import { detectWarnings, type Facts, type WarningDraft } from './engine';

export interface RunResult {
  patients: number;
  open: number;
  created: number;
  resolved: number;
}

const rowsOf = async <T>(db: Db, q: ReturnType<typeof sql>) =>
  (await db.execute<T & Record<string, unknown>>(q)).rows as T[];
const fileCols = sql`v.id AS "versionId", v.label, v.source_url AS "sourceUrl", v.effective_date::text AS "effectiveDate"`;

export async function loadFacts(db: Db, today: string, patientIds?: string[]): Promise<Facts> {
  const only = patientIds ? sql`AND patient_id = ANY(${sql.param(patientIds)}::uuid[])` : sql``;
  const fills = await rowsOf<Facts['fills'][number]>(
    db,
    sql`SELECT DISTINCT ON (f.patient_id, coalesce(f.rxcui, f.ndc, f.medication_id::text))
               f.id, f.patient_id AS "patientId", f.medication_id AS "medicationId", f.rxcui, f.ndc,
               coalesce(m.display_name, d.name, f.ndc, '') AS name, f.fill_date::text AS "fillDate",
               f.days_supply AS "daysSupply", f.refills_remaining AS "refillsRemaining", f.pharmacy_id AS "pharmacyId"
          FROM care.fill f
          JOIN care.patient p ON p.id = f.patient_id AND p.status = 'active'
          LEFT JOIN care.medication m ON m.id = f.medication_id
          LEFT JOIN care.drug d ON d.ndc = f.ndc
         WHERE f.fill_date >= ${today}::date - 400 ${patientIds ? sql`AND f.patient_id = ANY(${sql.param(patientIds)}::uuid[])` : sql``}
         ORDER BY f.patient_id, coalesce(f.rxcui, f.ndc, f.medication_id::text), f.fill_date DESC, f.id DESC`,
  );
  const rxcuis = [...new Set(fills.map((f) => f.rxcui).filter((r): r is string => !!r))];
  const year = Number(today.slice(0, 4));
  // Sequential on purpose: one transaction = one connection.
  const all = <T extends unknown[]>(qs: { [K in keyof T]: () => Promise<T[K]> }) =>
    qs.reduce<Promise<unknown[]>>(
      async (acc, q) => [...(await acc), await q()],
      Promise.resolve([]),
    ) as Promise<T>;
  const [patientPlans, plans, formulary, prices, pbmChanges, shortages, closures] = await all<
    [
      Facts['patientPlans'],
      Facts['plans'],
      Facts['formulary'],
      Facts['prices'],
      Facts['pbmChanges'],
      Facts['shortages'],
      Facts['closures'],
    ]
  >([
    () =>
      rowsOf<Facts['patientPlans'][number]>(
        db,
        sql`SELECT patient_id AS "patientId", year, contract_id || '-' || plan_id || '-' || segment_id AS "planKey"
            FROM care.patient_plan WHERE year IN (${year}, ${year + 1}) ${only}`,
      ),
    () =>
      rowsOf<Facts['plans'][number]>(
        db,
        sql`SELECT ${fileCols}, p.year, p.contract_id || '-' || p.plan_id || '-' || p.segment_id AS "planKey",
                 p.name, p.premium_cents AS "premiumCents", p.formulary_id AS "formularyId"
            FROM care.plan p JOIN care.data_file_version v ON v.id = p.version_id
           WHERE p.year IN (${year}, ${year + 1})`,
      ),
    () =>
      rowsOf<Facts['formulary'][number]>(
        db,
        sql`SELECT version_id AS "versionId", formulary_id AS "formularyId", rxcui, tier
            FROM care.formulary_entry WHERE rxcui = ANY(${sql.param(rxcuis)}::text[])`,
      ),
    () =>
      rowsOf<Facts['prices'][number]>(
        db,
        // ponytail: 30-day cost estimated at one unit a day; the pricing file has no units-per-day.
        sql`SELECT version_id AS "versionId", contract_id || '-' || plan_id || '-' || segment_id AS "planKey", rxcui,
                 round(unit_cost * 30 * 100)::int AS "costCents"
            FROM care.drug_price WHERE days_supply = 30 AND rxcui = ANY(${sql.param(rxcuis)}::text[])`,
      ),
    () =>
      rowsOf<Facts['pbmChanges'][number]>(
        db,
        sql`SELECT ${fileCols}, c.formulary_id AS "formularyId", c.rxcui, c.change, c.new_tier AS "newTier",
                 c.effective_date::text AS "changeDate"
            FROM care.formulary_change c JOIN care.data_file_version v ON v.id = c.version_id
           WHERE c.rxcui = ANY(${sql.param(rxcuis)}::text[])`,
      ),
    () =>
      rowsOf<Facts['shortages'][number]>(
        db,
        sql`SELECT ${fileCols}, s.rxcui, s.reported_on::text AS "reportedOn", s.resolved_on::text AS "resolvedOn"
            FROM care.drug_shortage s JOIN care.data_file_version v ON v.id = s.version_id
           WHERE s.rxcui = ANY(${sql.param(rxcuis)}::text[])`,
      ),
    () =>
      rowsOf<Facts['closures'][number]>(
        db,
        sql`SELECT ${fileCols}, c.pharmacy_id AS "pharmacyId", ph.name AS "pharmacyName", c.closes_on::text AS "closesOn"
            FROM care.pharmacy_closure c JOIN care.data_file_version v ON v.id = c.version_id
            JOIN care.pharmacy ph ON ph.id = c.pharmacy_id`,
      ),
  ]);
  const pgx = await rowsOf<NonNullable<Facts['pgx']>[number]>(
    db,
    sql`SELECT id AS "resultId", patient_id AS "patientId", gene, diplotype, phenotype, reported_at::text AS "reportedAt", lab
          FROM care.pgx_result ${patientIds ? sql`WHERE patient_id = ANY(${sql.param(patientIds)}::uuid[])` : sql``}`,
  );
  const geneRules = await rowsOf<NonNullable<Facts['geneRules']>[number]>(
    db,
    sql`SELECT gene, phenotype, rxcui, drug, recommendation_code AS "recommendationCode", source_url AS "sourceUrl", version
          FROM care.gene_drug_rule`,
  );
  return {
    today,
    fills,
    patientPlans,
    plans,
    formulary,
    prices,
    pbmChanges,
    shortages,
    closures,
    pgx,
    geneRules,
  };
}

/** Writes drafts and returns counts. Runs inside the caller's transaction. */
export async function saveWarnings(
  db: Db,
  drafts: WarningDraft[],
  patientIds?: string[],
): Promise<Omit<RunResult, 'patients'>> {
  let created = 0;
  const changed = new Set<string>();
  for (let i = 0; i < drafts.length; i += 500) {
    const chunk = drafts.slice(i, i + 500);
    const r = await rowsOf<{ patient_id: string; doctor_only: boolean; n: number }>(
      db,
      sql`WITH x AS (
            SELECT * FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) AS x(
              "patientId" uuid, "medicationId" uuid, rxcui text, type text, "problemDate" date,
              "daysUntilProblem" int, "accessStatus" text, "sourceKind" text, "sourceRef" text,
              "sourceDate" date, evidence jsonb, "dedupeKey" text)
          ), up AS (
            INSERT INTO care.warning (patient_id, medication_id, rxcui, type, problem_date, days_until_problem,
                                      access_status, source_kind, source_ref, source_date, evidence, dedupe_key)
            SELECT "patientId", "medicationId", rxcui, type, "problemDate", "daysUntilProblem", "accessStatus",
                   "sourceKind", "sourceRef", "sourceDate", evidence, "dedupeKey" FROM x
            ON CONFLICT (dedupe_key) WHERE status = 'open' DO UPDATE
               SET problem_date = EXCLUDED.problem_date, days_until_problem = EXCLUDED.days_until_problem,
                   access_status = EXCLUDED.access_status, evidence = EXCLUDED.evidence
            RETURNING id, patient_id, type, (xmax = 0) AS inserted, type = 'gene_drug_mismatch' AS doctor_only
          )
          SELECT patient_id, doctor_only, count(audit.append('create', 'warning', id::text, patient_id, 'treatment',
                                    jsonb_build_object('type', type)))::int AS n
            FROM up WHERE inserted GROUP BY patient_id, doctor_only`,
    );
    for (const x of r) {
      created += x.n;
      if (!x.doctor_only) changed.add(x.patient_id);
    }
  }
  const keys = drafts.map((d) => d.dedupeKey);
  const gone = await rowsOf<{ patient_id: string; doctor_only: boolean; n: number }>(
    db,
    sql`WITH gone AS (
          UPDATE care.warning SET status = 'resolved', resolved_at = now(), outcome = 'unknown'
           WHERE status = 'open' AND source_kind IN ('fill', 'data_file', 'pgx')
             AND NOT (dedupe_key = ANY(${sql.param(keys)}::text[]))
             ${patientIds ? sql`AND patient_id = ANY(${sql.param(patientIds)}::uuid[])` : sql``}
          RETURNING id, patient_id, type, type = 'gene_drug_mismatch' AS doctor_only)
        SELECT patient_id, doctor_only, count(audit.append('update', 'warning', id::text, patient_id, 'treatment',
                                  jsonb_build_object('type', type, 'status', 'resolved')))::int AS n
          FROM gone GROUP BY patient_id, doctor_only`,
  );
  for (const x of gone) if (!x.doctor_only) changed.add(x.patient_id);
  // §6: the family card refreshes live. One event per patient whose family-visible warnings
  // changed; ids only. Doctor-only (gene-drug) changes send none, so nothing hints at them.
  if (changed.size)
    await db.execute(sql`INSERT INTO care.outbox (topic, aggregate_type, aggregate_id, practice_id, household_id)
      SELECT 'warning.changed', 'patient', id, practice_id, household_id FROM care.patient
       WHERE id = ANY(${sql.param([...changed])}::uuid[])`);
  return { open: drafts.length, created, resolved: gone.reduce((a, x) => a + x.n, 0) };
}

export async function runEngine(db: Db, o: { today: string; patientIds?: string[] }): Promise<RunResult> {
  const facts = await loadFacts(db, o.today, o.patientIds);
  const drafts = detectWarnings(facts);
  const saved = await saveWarnings(db, drafts, o.patientIds);
  return { patients: new Set(facts.fills.map((f) => f.patientId)).size, ...saved };
}
