import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import type { RequestScope } from '@tomoni/core';
import * as schema from './schema';
import { env } from './env';

export type Db = NodePgDatabase<typeof schema>;
export type DbRole = 'app' | 'worker' | 'owner';

const urls: Record<DbRole, () => string> = {
  app: () => env().DATABASE_URL,
  worker: () => env().DATABASE_WORKER_URL,
  owner: () => env().DATABASE_OWNER_URL,
};

const pools = new Map<string, pg.Pool>();

/** One pool per (role, url). Tests override the database via TOMONI_DB_NAME. */
export function pool(role: DbRole): pg.Pool {
  const url = withDbName(urls[role]());
  let p = pools.get(url);
  if (!p) {
    p = new pg.Pool({ connectionString: url, max: role === 'owner' ? 2 : 20 });
    pools.set(url, p);
  }
  return p;
}

function withDbName(url: string): string {
  const name = process.env.TOMONI_DB_NAME;
  if (!name) return url;
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export async function closePools(): Promise<void> {
  await Promise.all([...pools.values()].map((p) => p.end()));
  pools.clear();
}

/**
 * Run `fn` inside one transaction whose RLS scope is `scope`. This is the only way request
 * code touches the database: every query inside sees exactly what the scope allows.
 */
export async function withScope<T>(
  role: 'app' | 'worker',
  scope: RequestScope,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const client = await pool(role).connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.actor_kind', $1, true), set_config('app.actor_id', $2, true),
              set_config('app.user_id', $3, true), set_config('app.roles', $4, true),
              set_config('app.is_admin', $5, true), set_config('app.staff_roles', $6, true),
              set_config('app.staff_practice_ids', $7, true), set_config('app.ops_practice_ids', $8, true),
              set_config('app.household_ids', $9, true), set_config('app.patient_ids', $10, true)`,
      [
        scope.actorKind,
        scope.actorId,
        scope.userId ?? '',
        scope.roles.join(','),
        String(scope.isAdmin),
        scope.staffRoles.join(','),
        scope.staffPracticeIds.join(','),
        scope.opsPracticeIds.join(','),
        scope.householdIds.join(','),
        scope.patientIds.join(','),
      ],
    );
    const result = await fn(drizzle(client, { schema }));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Owner connection for migrations and the dev seed only. Never used by request code. */
export function ownerDb(): Db {
  return drizzle(pool('owner'), { schema });
}

export { sql };
