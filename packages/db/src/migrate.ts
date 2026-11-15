import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './client';
import { realDataEnabled } from './env';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

/**
 * Apply migrations/NNNN_*.sql in order, each in its own transaction, as the owner role.
 * Applied files are checksummed; editing one after it ran is an error (add a new migration).
 */
export async function migrate(log: (m: string) => void = () => {}): Promise<string[]> {
  const db = pool('owner');
  await db.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
    name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Map(
    (await db.query<{ name: string; sha256: string }>('SELECT name, sha256 FROM public.schema_migrations')).rows.map(
      (r) => [r.name, r.sha256],
    ),
  );
  const ran: string[] = [];
  for (const file of readdirSync(DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()) {
    const body = readFileSync(path.join(DIR, file), 'utf8');
    const sum = createHash('sha256').update(body).digest('hex');
    const prev = applied.get(file);
    if (prev) {
      if (prev !== sum) throw new Error(`migration ${file} was edited after it was applied`);
      continue;
    }
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query(body);
      await c.query('INSERT INTO public.schema_migrations (name, sha256) VALUES ($1, $2)', [file, sum]);
      await c.query('COMMIT');
      log(`applied ${file}`);
      ran.push(file);
    } catch (e) {
      await c.query('ROLLBACK');
      throw new Error(`migration ${file} failed: ${(e as Error).message}`, { cause: e });
    } finally {
      c.release();
    }
  }
  return ran;
}

/** Drop everything. Dev/test only; refuses when real data is enabled. */
export async function reset(): Promise<void> {
  if (realDataEnabled() || process.env.NODE_ENV === 'production') throw new Error('reset refused: real data enabled');
  await pool('owner').query(`
    DROP SCHEMA IF EXISTS app, auth, care, research, audit, sponsor CASCADE;
    DROP TABLE IF EXISTS public.schema_migrations;`);
}
