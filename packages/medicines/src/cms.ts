/**
 * CMS Part D public files ("Prescription Drug Plan Formulary, Pharmacy Network, and Pricing
 * Information"): pipe-delimited text with a header row. One release = plan information,
 * basic drugs formulary and pricing files published together. Rows are parsed against a strict
 * schema; rows that don't conform are dropped and counted, never guessed at (SECURITY: loaders).
 */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';

const yn = z.enum(['Y', 'N']).transform((v) => v === 'Y');
const id = z.string().regex(/^[A-Z0-9]{1,10}$/);
const ndc = z.string().regex(/^\d{11}$/);
const rxcui = z.string().regex(/^\d{1,10}$/);
const dollars = z
  .string()
  .regex(/^\d{1,7}(\.\d{1,5})?$/)
  .transform(Number);

export const PlanRow = z.object({
  CONTRACT_ID: id,
  PLAN_ID: z.string().regex(/^\d{3}$/),
  SEGMENT_ID: z.string().regex(/^\d{1,3}$/),
  CONTRACT_NAME: z.string().min(1).max(200),
  PLAN_NAME: z.string().min(1).max(200),
  FORMULARY_ID: z.string().regex(/^\d{8}$/),
  PREMIUM: dollars,
  DEDUCTIBLE: dollars,
});
export const FormularyRow = z.object({
  FORMULARY_ID: z.string().regex(/^\d{8}$/),
  CONTRACT_YEAR: z
    .string()
    .regex(/^20\d\d$/)
    .transform(Number),
  RXCUI: rxcui,
  NDC: ndc,
  TIER_LEVEL_VALUE: z
    .string()
    .regex(/^[1-7]$/)
    .transform(Number),
  QUANTITY_LIMIT_YN: yn,
  PRIOR_AUTHORIZATION_YN: yn,
  STEP_THERAPY_YN: yn,
});
export const PricingRow = z.object({
  CONTRACT_ID: id,
  PLAN_ID: z.string().regex(/^\d{3}$/),
  SEGMENT_ID: z.string().regex(/^\d{1,3}$/),
  NDC: ndc,
  DAYS_SUPPLY: z.enum(['1', '2', '3']).transform((c) => ({ '1': 30, '2': 60, '3': 90 })[c]),
  UNIT_COST: dollars,
});

export interface Parsed<T> {
  rows: T[];
  dropped: number;
}

/** Parse delimited text with a header row; each row must satisfy `schema` or it is dropped. */
export function parseDelimited<S extends z.ZodType>(text: string, schema: S, sep = '|'): Parsed<z.output<S>> {
  const lines =
    sep === ','
      ? parseCsv(text)
      : text
          .split(/\r?\n/)
          .filter((l) => l.trim() !== '' && !l.startsWith('#'))
          .map((l) => l.split(sep));
  const header = (lines.shift() ?? []).map((h) => h.trim());
  const rows: z.output<S>[] = [];
  let dropped = 0;
  for (const cells of lines) {
    const r = parseRow(header, cells, schema);
    if (r) rows.push(r);
    else dropped++;
  }
  return { rows, dropped };
}

function parseRow<S extends z.ZodType>(header: string[], cells: string[], schema: S): z.output<S> | null {
  if (cells.length !== header.length) return null;
  const r = schema.safeParse(Object.fromEntries(header.map((h, i) => [h, cells[i]!.trim()])));
  return r.success ? r.data : null;
}

/**
 * A pipe-delimited file, streamed: valid rows in batches, so a multi-gigabyte CMS release never
 * sits in memory. `counts` fills in as it goes.
 */
export async function* streamDelimited<S extends z.ZodType>(
  file: string,
  schema: S,
  counts = { rows: 0, dropped: 0 },
  batch = 1000,
): AsyncGenerator<z.output<S>[]> {
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let header: string[] | null = null;
  let out: z.output<S>[] = [];
  for await (const l of lines) {
    if (l.trim() === '' || l.startsWith('#')) continue;
    const cells = l.split('|');
    if (!header) {
      header = cells.map((h) => h.trim());
      continue;
    }
    const r = parseRow(header, cells, schema);
    if (!r) {
      counts.dropped++;
      continue;
    }
    counts.rows++;
    out.push(r);
    if (out.length >= batch) {
      yield out;
      out = [];
    }
  }
  if (out.length) yield out;
}

/** sha256 over the files in order, streamed (the same digest as hashing their joined text). */
export async function sha256Files(files: string[]) {
  const hash = createHash('sha256');
  for (const f of files) for await (const chunk of createReadStream(f)) hash.update(chunk as Buffer);
  return hash.digest();
}

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF). Blank lines and `#` comment lines are skipped. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const end = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    end();
    if (!(row.length === 1 && row[0]!.trim() === '') && !row[0]!.startsWith('#')) out.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') end();
    else if (c === '\n') endRow();
    else if (c !== '\r') cell += c;
    i++;
  }
  if (cell !== '' || row.length) endRow();
  return out;
}

export const Manifest = z.strictObject({
  label: z.string().min(1).max(120),
  year: z.number().int().min(2020).max(2100),
  effectiveDate: z.iso.date(),
  sourceUrl: z.url(),
  files: z.strictObject({ plan: z.string(), formulary: z.string(), pricing: z.string() }),
});
export type Manifest = z.infer<typeof Manifest>;

/** The release's manifest and its three files, in hashing order. */
export function cmsReleaseFiles(dir: string) {
  const manifest = Manifest.parse(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')));
  const at = (f: string) => path.join(dir, path.basename(f));
  return {
    manifest,
    plan: at(manifest.files.plan),
    formulary: at(manifest.files.formulary),
    pricing: at(manifest.files.pricing),
  };
}

export const planKey = (p: { contractId: string; planId: string; segmentId: string }) =>
  `${p.contractId}-${p.planId}-${p.segmentId}`;
