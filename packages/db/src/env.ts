import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** Walk up to the monorepo root (the directory holding pnpm-workspace.yaml). */
export function repoRoot(from = process.cwd()): string {
  let dir = from;
  while (!existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error('repo root not found');
    dir = up;
  }
  return dir;
}

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_OWNER_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
  DATABASE_WORKER_URL: z.string().url(),
  DATABASE_SPONSOR_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  TOMONI_FIELD_KEYS: z.string().min(1),
  TOMONI_HMAC_KEY: z.string().min(1),
  TOMONI_SESSION_SECRET: z.string().min(1),
  TOMONI_REAL_DATA_ENABLED: z.enum(['true', 'false']).default('false'),
});
export type Env = z.infer<typeof Env>;

let cached: Env | undefined;

/** Loads <root>/.env once (if present; real env vars win), then validates. */
export function env(): Env {
  if (cached) return cached;
  const file = path.join(repoRoot(), '.env');
  if (existsSync(file)) {
    const before = { ...process.env };
    process.loadEnvFile(file);
    Object.assign(process.env, before);
  }
  cached = Env.parse(process.env);
  return cached;
}

export const realDataEnabled = () => env().TOMONI_REAL_DATA_ENABLED === 'true';
