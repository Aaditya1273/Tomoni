/**
 * PBM formulary change lists (BUILD_PROMPT §5.1): every PBM sends a different CSV, so an admin
 * maps its columns once per upload. Values are normalized and checked; a row that doesn't fit
 * is dropped with a reason, never guessed at.
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit, schema, type Db } from '@tomoni/db';
import { parseCsv } from './cms';

export const PBM_MAX_BYTES = 2 * 1024 * 1024;
export const PBM_MAX_ROWS = 20_000;

export const PbmMapping = z.strictObject({
  formularyId: z.string().min(1).max(100),
  drug: z.strictObject({ column: z.string().min(1).max(100), kind: z.enum(['rxcui', 'ndc']) }),
  change: z.string().min(1).max(100),
  newTier: z.string().min(1).max(100).nullable(),
  effectiveDate: z.string().min(1).max(100),
});
export type PbmMapping = z.infer<typeof PbmMapping>;

export interface PbmRow {
  formularyId: string;
  rxcui: string | null;
  ndc: string | null;
  change: 'removal' | 'tier_change';
  newTier: number | null;
  effectiveDate: string;
}

export function pbmPreview(text: string) {
  const rows = parseCsv(text);
  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, sample: rows.slice(0, 5), rowCount: rows.length };
}

const isoDate = (v: string): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) ?? null;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  const [y, mo, d] = m
    ? [m[1], m[2], m[3]]
    : us
      ? [us[3], us[1]!.padStart(2, '0'), us[2]!.padStart(2, '0')]
      : [];
  if (!y) return null;
  const iso = `${y}-${mo}-${d}`;
  return z.iso.date().safeParse(iso).success ? iso : null;
};
const changeOf = (v: string): PbmRow['change'] | null =>
  /remov|delet|drop|exclu|not covered/i.test(v) ? 'removal' : /tier/i.test(v) ? 'tier_change' : null;

export function applyPbmMapping(text: string, m: PbmMapping) {
  const rows = parseCsv(text);
  const headers = (rows.shift() ?? []).map((h) => h.trim());
  const col = (name: string) => headers.indexOf(name);
  const idx = {
    formularyId: col(m.formularyId),
    drug: col(m.drug.column),
    change: col(m.change),
    newTier: m.newTier === null ? -1 : col(m.newTier),
    effectiveDate: col(m.effectiveDate),
  };
  const missing = Object.entries(idx)
    .filter(([k, i]) => i < 0 && !(k === 'newTier' && m.newTier === null))
    .map(([k]) => k);
  if (missing.length) return { ok: false as const, missing };

  const out: PbmRow[] = [];
  const dropped: { line: number; reason: string }[] = [];
  rows.slice(0, PBM_MAX_ROWS).forEach((cells, i) => {
    const line = i + 2;
    const get = (j: number) => (j < 0 ? '' : (cells[j] ?? '').trim());
    const formularyId = get(idx.formularyId);
    const drug = get(idx.drug).replace(/-/g, '');
    const change = changeOf(get(idx.change));
    const tierText = get(idx.newTier);
    const effectiveDate = isoDate(get(idx.effectiveDate));
    const drugOk = m.drug.kind === 'rxcui' ? /^\d{1,10}$/.test(drug) : /^\d{11}$/.test(drug);
    const tier = /^[1-7]$/.test(tierText) ? Number(tierText) : null;
    const reason = !/^[A-Za-z0-9-]{1,20}$/.test(formularyId)
      ? 'formulary id'
      : !drugOk
        ? m.drug.kind
        : !change
          ? 'change type'
          : !effectiveDate
            ? 'effective date'
            : change === 'tier_change' && tier === null
              ? 'new tier'
              : null;
    if (reason) {
      dropped.push({ line, reason });
      return;
    }
    out.push({
      formularyId,
      rxcui: m.drug.kind === 'rxcui' ? drug : null,
      ndc: m.drug.kind === 'ndc' ? drug : null,
      change: change!,
      newTier: change === 'tier_change' ? tier : null,
      effectiveDate: effectiveDate!,
    });
  });
  const overLimit = Math.max(0, rows.length - PBM_MAX_ROWS);
  return { ok: true as const, rows: out, dropped, overLimit, total: rows.length };
}

/**
 * Store a mapped list as one data_file_version plus its changes (inside the caller's transaction,
 * as an admin). NDCs are turned into RxCUIs with the drug list; unknown NDCs are dropped.
 */
export async function savePbmChanges(
  db: Db,
  o: { text: string; label: string; rows: PbmRow[]; dropped: number; loadedBy: string },
) {
  const ndcs = o.rows.map((r) => r.ndc).filter((n): n is string => !!n);
  const known = ndcs.length
    ? new Map(
        (
          await db.execute<{ ndc: string; rxcui: string }>(
            sql`SELECT ndc, rxcui FROM care.drug WHERE ndc = ANY(${sql.param(ndcs)}::text[])`,
          )
        ).rows.map((r) => [r.ndc, r.rxcui]),
      )
    : new Map<string, string>();
  const byKey = new Map<string, PbmRow & { rxcui: string }>();
  let unknown = 0;
  for (const r of o.rows) {
    const rxcui = r.rxcui ?? known.get(r.ndc!);
    if (!rxcui) {
      unknown++;
      continue;
    }
    byKey.set(`${r.formularyId}|${rxcui}`, { ...r, rxcui }); // last row for a drug wins
  }
  const rows = [...byKey.values()];
  if (!rows.length) return { versionId: null, saved: 0, unknown, duplicate: false };
  const sha256 = createHash('sha256').update('pbm_changes').update(o.text).digest();
  const [v] = await db
    .insert(schema.dataFileVersion)
    .values({
      kind: 'pbm_changes',
      label: o.label,
      sourceUrl: 'upload:pbm',
      sha256,
      effectiveDate: rows.map((r) => r.effectiveDate).sort()[0]!,
      rowCount: rows.length,
      droppedCount: o.dropped + unknown,
      loadedBy: o.loadedBy,
    })
    .onConflictDoNothing({ target: schema.dataFileVersion.sha256 })
    .returning({ id: schema.dataFileVersion.id });
  if (!v) return { versionId: null, saved: 0, unknown, duplicate: true };
  for (let i = 0; i < rows.length; i += 500)
    await db.insert(schema.formularyChange).values(
      rows.slice(i, i + 500).map((r) => ({
        versionId: v.id,
        formularyId: r.formularyId,
        rxcui: r.rxcui,
        change: r.change,
        newTier: r.newTier,
        effectiveDate: r.effectiveDate,
      })),
    );
  await audit(db, {
    action: 'create',
    entityType: 'data_file_version',
    entityId: v.id,
    purpose: 'operations',
    details: { kind: 'pbm_changes', rows: rows.length, dropped: o.dropped + unknown },
  });
  return { versionId: v.id, saved: rows.length, unknown, duplicate: false };
}
