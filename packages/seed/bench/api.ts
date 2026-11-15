/**
 * §6 read latency: seed a throwaway database, start the API against it, and run k6 (Docker) with
 * a p95 < 300 ms threshold. Exits non-zero when the target is missed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DB = 'tomoni_perf';
const PORT = '4010';
const ORIGIN = 'http://localhost:3010';
Object.assign(process.env, { TOMONI_DB_NAME: DB, NODE_ENV: 'test', TOMONI_TODAY: '2026-11-15' });
// After the env: the db package reads it on import.
const { closePools, ensureDatabase, migrate, reset } = await import('@tomoni/db');
const { DEMO_PASSWORD, seed } = await import('../src/seed');
await ensureDatabase(DB);
await reset();
await migrate();
await seed();
await closePools();

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const api = spawn('pnpm', ['--filter', '@tomoni/api', 'start'], {
  cwd: repo,
  stdio: 'inherit',
  env: {
    ...process.env,
    API_PORT: PORT,
    LOG_LEVEL: 'warn',
    TOMONI_LOGIN_LIMIT: '1000',
    TOMONI_ALLOWED_ORIGINS: ORIGIN,
    TOMONI_QUEUE_PREFIX: 'perf',
  },
});
try {
  for (let i = 0; ; i++) {
    if (
      await fetch(`http://127.0.0.1:${PORT}/api/system/health`).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    if (i > 60) throw new Error('API did not start');
    await new Promise((r) => setTimeout(r, 1000));
  }
  const k6 = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'host',
      '-v',
      `${repo}packages/seed/bench:/bench:ro`,
      '-e',
      `API=http://127.0.0.1:${PORT}`,
      '-e',
      `ORIGIN=${ORIGIN}`,
      '-e',
      `PW=${DEMO_PASSWORD}`,
      'grafana/k6:1.4.2',
      'run',
      '--quiet',
      '/bench/k6-reads.js',
    ],
    { stdio: 'inherit' },
  );
  process.exitCode = k6.status ?? 1;
} finally {
  api.kill('SIGTERM');
}
