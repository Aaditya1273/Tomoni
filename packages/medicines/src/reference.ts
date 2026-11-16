/**
 * Loads reference data (not PHI) into the database: the bundled samples in dev and CI, the real
 * public files when an operator points the loader at them. Every load is one data_file_version
 * row keyed by sha256, so loading the same file twice does nothing.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Db } from '@tomoni/db';
import {
  cmsReleaseFiles,
  FormularyRow,
  parseDelimited,
  PlanRow,
  planKey,
  PricingRow,
  sha256Files,
  streamDelimited,
} from './cms';
import type { SynthDrug } from './bluebutton/synth';

export const SAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'samples');

const DrugRow = z.object({
  ndc: z.string().regex(/^\d{11}$/),
  rxcui: z.string().regex(/^\d{1,10}$/),
  name: z.string().min(1).max(200),
});
const PharmacyRow = z.object({
  npi: z.string().regex(/^\d{10}$/),
  name: z.string().min(1).max(200),
  address: z.string().max(200),
  phone: z.string().max(40),
});
const ShortageRow = z.object({
  rxcui: z.string().regex(/^\d{1,10}$/),
  reported_on: z.iso.date(),
  resolved_on: z.union([z.iso.date(), z.literal('').transform(() => null)]),
});
const ClosureRow = z.object({ npi: z.string().regex(/^\d{10}$/), closes_on: z.iso.date() });

const read = (f: string) => readFileSync(f, 'utf8');
const sha = (...parts: string[]) => parts.reduce((h, p) => h.update(p), createHash('sha256')).digest();

export const sampleDrugs = (): SynthDrug[] =>
  parseDelimited(read(path.join(SAMPLES, 'drugs.csv')), DrugRow, ',').rows;
export const samplePharmacyNpis = () =>
  parseDelimited(read(path.join(SAMPLES, 'pharmacies.csv')), PharmacyRow, ',').rows.map((r) => r.npi);

async function newVersion(
  db: Db,
  v: Omit<typeof schema.dataFileVersion.$inferInsert, 'id' | 'loadedAt'>,
): Promise<string | null> {
  const [row] = await db
    .insert(schema.dataFileVersion)
    .values(v)
    .onConflictDoNothing({ target: schema.dataFileVersion.sha256 })
    .returning({ id: schema.dataFileVersion.id });
  return row?.id ?? null;
}

const chunks = <T>(xs: T[], n = 500) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function loadDrugs(db: Db, file = path.join(SAMPLES, 'drugs.csv')) {
  const { rows } = parseDelimited(read(file), DrugRow, ',');
  for (const c of chunks(rows)) await db.insert(schema.drug).values(c).onConflictDoNothing();
  return rows.length;
}

export async function loadPharmacies(db: Db, file = path.join(SAMPLES, 'pharmacies.csv')) {
  const { rows } = parseDelimited(read(file), PharmacyRow, ',');
  await db
    .insert(schema.pharmacy)
    .values(rows.map((r) => ({ ...r, address: r.address || null, phone: r.phone || null })))
    .onConflictDoNothing();
  return rows.length;
}

/**
 * Returns the new version id, or null when this exact release was already loaded. Streams the
 * files (a full CMS release is gigabytes) and loads in one transaction, so a crash mid-load
 * leaves nothing behind, never a version marked loaded with half its rows.
 */
export async function loadCmsRelease(db: Db, dir: string, loadedBy: string): Promise<string | null> {
  const f = cmsReleaseFiles(dir);
  const m = f.manifest;
  const sha256 = await sha256Files([f.plan, f.formulary, f.pricing]);
  const seen = await db
    .select({ id: schema.dataFileVersion.id })
    .from(schema.dataFileVersion)
    .where(sql`sha256 = ${sha256}`);
  if (seen.length) return null;

  return db.transaction(async (tx) => {
    const versionId = await newVersion(tx, {
      kind: 'cms_partd',
      label: m.label,
      sourceUrl: m.sourceUrl,
      sha256,
      effectiveDate: m.effectiveDate,
      rowCount: 0,
      droppedCount: 0,
      loadedBy,
    });
    if (!versionId) return null;
    const counts = { rows: 0, dropped: 0 };

    for await (const batch of streamDelimited(f.plan, PlanRow, counts))
      await tx.insert(schema.plan).values(
        batch.map((p) => ({
          versionId,
          year: m.year,
          contractId: p.CONTRACT_ID,
          planId: p.PLAN_ID,
          segmentId: p.SEGMENT_ID,
          name: p.PLAN_NAME,
          type: p.CONTRACT_ID.startsWith('S') ? ('pdp' as const) : ('mapd' as const),
          premiumCents: Math.round(p.PREMIUM * 100),
          deductibleCents: Math.round(p.DEDUCTIBLE * 100),
          formularyId: p.FORMULARY_ID,
        })),
      );

    // One row per (formulary, rxcui): the file lists every NDC; tiers are per RxCUI, last row wins.
    // NDC → RxCUI stays in memory (tens of thousands of drugs) for pricing and drug names.
    const rxOfNdc = new Map<string, string>();
    for await (const batch of streamDelimited(f.formulary, FormularyRow, counts)) {
      const entries = new Map<string, typeof schema.formularyEntry.$inferInsert>();
      for (const r of batch) {
        rxOfNdc.set(r.NDC, r.RXCUI);
        entries.set(`${r.FORMULARY_ID}|${r.RXCUI}`, {
          versionId,
          formularyId: r.FORMULARY_ID,
          rxcui: r.RXCUI,
          tier: r.TIER_LEVEL_VALUE,
          priorAuth: r.PRIOR_AUTHORIZATION_YN,
          stepTherapy: r.STEP_THERAPY_YN,
          quantityLimit: r.QUANTITY_LIMIT_YN,
        });
      }
      await tx
        .insert(schema.formularyEntry)
        .values([...entries.values()])
        .onConflictDoUpdate({
          target: [
            schema.formularyEntry.versionId,
            schema.formularyEntry.formularyId,
            schema.formularyEntry.rxcui,
          ],
          set: {
            tier: sql`excluded.tier`,
            priorAuth: sql`excluded.prior_auth`,
            stepTherapy: sql`excluded.step_therapy`,
            quantityLimit: sql`excluded.quantity_limit`,
          },
        });
    }
    // Names come from the drug list; the CMS files carry none.
    for (const c of chunks([...rxOfNdc.entries()]))
      await tx
        .insert(schema.drug)
        .values(c.map(([ndc, rxcui]) => ({ ndc, rxcui, name: `RxCUI ${rxcui}` })))
        .onConflictDoNothing();

    for await (const batch of streamDelimited(f.pricing, PricingRow, counts)) {
      const prices = new Map<string, typeof schema.drugPrice.$inferInsert>();
      for (const p of batch) {
        const rxcui = rxOfNdc.get(p.NDC);
        if (!rxcui) continue;
        const k = `${planKey({ contractId: p.CONTRACT_ID, planId: p.PLAN_ID, segmentId: p.SEGMENT_ID })}|${rxcui}|${p.DAYS_SUPPLY}`;
        prices.set(k, {
          versionId,
          contractId: p.CONTRACT_ID,
          planId: p.PLAN_ID,
          segmentId: p.SEGMENT_ID,
          rxcui,
          daysSupply: p.DAYS_SUPPLY,
          unitCost: String(p.UNIT_COST),
        });
      }
      if (prices.size)
        await tx
          .insert(schema.drugPrice)
          .values([...prices.values()])
          .onConflictDoUpdate({
            target: [
              schema.drugPrice.versionId,
              schema.drugPrice.contractId,
              schema.drugPrice.planId,
              schema.drugPrice.segmentId,
              schema.drugPrice.rxcui,
              schema.drugPrice.daysSupply,
            ],
            set: { unitCost: sql`excluded.unit_cost` },
          });
    }
    await tx
      .update(schema.dataFileVersion)
      .set({ rowCount: counts.rows, droppedCount: counts.dropped })
      .where(sql`id = ${versionId}`);
    return versionId;
  });
}

export async function loadShortages(
  db: Db,
  file: string,
  meta: { label: string; sourceUrl: string; effectiveDate: string; loadedBy: string },
) {
  const text = read(file);
  const { rows, dropped } = parseDelimited(text, ShortageRow, ',');
  const versionId = await newVersion(db, {
    kind: 'shortage',
    ...meta,
    sha256: sha('shortage', text),
    rowCount: rows.length,
    droppedCount: dropped,
  });
  if (versionId && rows.length)
    await db.insert(schema.drugShortage).values(
      rows.map((r) => ({
        versionId,
        rxcui: r.rxcui,
        reportedOn: r.reported_on,
        resolvedOn: r.resolved_on,
      })),
    );
  return versionId;
}

export async function loadClosures(
  db: Db,
  file: string,
  meta: { label: string; sourceUrl: string; effectiveDate: string; loadedBy: string },
) {
  const text = read(file);
  const parsed = parseDelimited(text, ClosureRow, ',');
  const ids = await db.execute<{ id: string; npi: string }>(
    sql`SELECT id, npi FROM care.pharmacy WHERE npi = ANY(${sql.param(parsed.rows.map((r) => r.npi))}::text[])`,
  );
  const byNpi = new Map(ids.rows.map((r) => [r.npi, r.id]));
  const rows = parsed.rows.filter((r) => byNpi.has(r.npi));
  const versionId = await newVersion(db, {
    kind: 'pharmacy_closure',
    ...meta,
    sha256: sha('pharmacy_closure', text),
    rowCount: rows.length,
    droppedCount: parsed.dropped + parsed.rows.length - rows.length,
  });
  if (versionId && rows.length)
    await db
      .insert(schema.pharmacyClosure)
      .values(rows.map((r) => ({ versionId, pharmacyId: byNpi.get(r.npi)!, closesOn: r.closes_on })));
  return versionId;
}

/** Everything bundled: drug names, pharmacies, two CMS releases, a shortage and a closure notice. */
export async function loadSamples(db: Db, loadedBy = 'seed') {
  await loadDrugs(db);
  await loadPharmacies(db);
  for (const dir of ['cms-2026', 'cms-2027']) await loadCmsRelease(db, path.join(SAMPLES, dir), loadedBy);
  await loadShortages(db, path.join(SAMPLES, 'shortages.csv'), {
    label: 'Synthetic sample shortage notice',
    sourceUrl: 'https://dps.fda.gov/drugshortages',
    effectiveDate: '2026-11-02',
    loadedBy,
  });
  await loadClosures(db, path.join(SAMPLES, 'pharmacy_closures.csv'), {
    label: 'Synthetic sample pharmacy closure notice',
    sourceUrl: 'https://npiregistry.cms.hhs.gov/',
    effectiveDate: '2026-11-05',
    loadedBy,
  });
}
