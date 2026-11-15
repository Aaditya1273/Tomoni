/**
 * §6 target: the warning engine reprocesses 10,000 patients in under 5 minutes on a laptop.
 * Builds a scratch database (tomoni_bench): the 500-patient seed copied 20 times, then times
 * one full engine run as the worker. `pnpm --filter @tomoni/seed bench`
 */
process.env.TOMONI_DB_NAME = 'tomoni_bench';
process.env.TOMONI_TODAY ??= '2026-11-15';
const { systemScope } = await import('@tomoni/core');
const { closePools, ensureDatabase, migrate, ownerDb, reset, sql, withScope } = await import('@tomoni/db');
const { seed } = await import('../src/seed');
const { runEngine, today } = await import('@tomoni/medicines');

await ensureDatabase('tomoni_bench');
await reset();
await migrate();
await seed(() => {});
const db = ownerDb();
// Copy every seeded patient 19 times, with their fills and plans, under fresh ids.
for (let i = 1; i < 20; i++) {
  await db.execute(sql`
    CREATE TEMP TABLE IF NOT EXISTS pair (old_id uuid, new_id uuid);
    TRUNCATE pair;
    INSERT INTO pair SELECT id, uuidv7() FROM care.patient WHERE mbi IS NOT NULL;
    INSERT INTO care.patient (id, practice_id, household_id, name, dob, birth_year, state, locale, tz, medicare_type)
      SELECT p.new_id, o.practice_id, o.household_id, o.name, o.dob, o.birth_year, o.state, o.locale, o.tz, o.medicare_type
        FROM pair p JOIN care.patient o ON o.id = p.old_id;
    INSERT INTO care.fill (patient_id, ndc, rxcui, fill_date, days_supply, quantity, fill_number, refills_remaining,
                           pharmacy_id, source, source_ref)
      SELECT p.new_id, f.ndc, f.rxcui, f.fill_date, f.days_supply, f.quantity, f.fill_number, f.refills_remaining,
             f.pharmacy_id, 'manual', f.source_ref || ':' || p.new_id
        FROM pair p JOIN care.fill f ON f.patient_id = p.old_id;
    INSERT INTO care.patient_plan (patient_id, year, contract_id, plan_id, segment_id)
      SELECT p.new_id, pp.year, pp.contract_id, pp.plan_id, pp.segment_id
        FROM pair p JOIN care.patient_plan pp ON pp.patient_id = p.old_id`);
}
const [{ n }] = (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM care.patient`)).rows as [
  { n: number },
];

const t0 = performance.now();
const r = await withScope('worker', systemScope('bench'), (w) => runEngine(w, { today: today() }));
const s = (performance.now() - t0) / 1000;
console.warn(
  `${n} patients: engine run ${s.toFixed(1)} s (budget 300 s); ${r.open} open, ${r.created} created, ${r.resolved} resolved`,
);
await closePools();
