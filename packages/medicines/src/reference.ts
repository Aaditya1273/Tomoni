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
import { parseDelimited, planKey, readCmsRelease } from './cms';
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

/** Returns the new version id, or null when this exact release was already loaded. */
export async function loadCmsRelease(db: Db, dir: string, loadedBy: string): Promise<string | null> {
  const r = readCmsRelease(dir);
  const m = r.manifest;
  const versionId = await newVersion(db, {
    kind: 'cms_partd',
    label: m.label,
    sourceUrl: m.sourceUrl,
    sha256: r.sha256,
    effectiveDate: m.effectiveDate,
    rowCount: r.plans.rows.length + r.formulary.rows.length + r.pricing.rows.length,
    droppedCount: r.plans.dropped + r.formulary.dropped + r.pricing.dropped,
    loadedBy,
  });
  if (!versionId) return null;

  await db.insert(schema.plan).values(
    r.plans.rows.map((p) => ({
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
  // One row per (formulary, rxcui): the file lists every NDC; tiers are per RxCUI.
  const entries = new Map(
    r.formulary.rows.map((f) => [
      `${f.FORMULARY_ID}|${f.RXCUI}`,
      {
        versionId,
        formularyId: f.FORMULARY_ID,
        rxcui: f.RXCUI,
        tier: f.TIER_LEVEL_VALUE,
        priorAuth: f.PRIOR_AUTHORIZATION_YN,
        stepTherapy: f.STEP_THERAPY_YN,
        quantityLimit: f.QUANTITY_LIMIT_YN,
      },
    ]),
  );
  for (const c of chunks([...entries.values()])) await db.insert(schema.formularyEntry).values(c);
  // Names come from the drug list; the CMS files carry none.
  const ndcs = [...new Map(r.formulary.rows.map((f) => [f.NDC, f.RXCUI])).entries()];
  for (const c of chunks(ndcs))
    await db
      .insert(schema.drug)
      .values(c.map(([ndc, rxcui]) => ({ ndc, rxcui, name: `RxCUI ${rxcui}` })))
      .onConflictDoNothing();

  const rxOfNdc = new Map(r.formulary.rows.map((f) => [f.NDC, f.RXCUI]));
  const prices = new Map<string, typeof schema.drugPrice.$inferInsert>();
  for (const p of r.pricing.rows) {
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
  for (const c of chunks([...prices.values()])) await db.insert(schema.drugPrice).values(c);
  return versionId;
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
