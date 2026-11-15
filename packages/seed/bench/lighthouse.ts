/**
 * §6: Lighthouse 90+ for performance and accessibility on the family app. Signs Asha in and
 * audits her card (mobile, Lighthouse defaults) against a fresh production build of apps/web,
 * three times, scoring the median run (Lighthouse's own advice on variance). Needs Playwright's Chromium.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const DB = 'tomoni_perf';
const WEB = 'http://localhost:3001';
const API_ORIGIN = 'http://127.0.0.1:4001'; // baked into the build's /api rewrite
Object.assign(process.env, { TOMONI_DB_NAME: DB, NODE_ENV: 'test', TOMONI_TODAY: '2026-11-15' });
const { closePools, ensureDatabase, migrate, reset } = await import('@tomoni/db');
const { DEMO_PASSWORD, seed } = await import('../src/seed');
await ensureDatabase(DB);
await reset();
await migrate();
await seed();
await closePools();

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const out = `${repo}node_modules/.cache/lighthouse`;
mkdirSync(`${out}/tmp`, { recursive: true });
const pw = `${homedir()}/.cache/ms-playwright`;
const chrome = `${pw}/${readdirSync(pw).find((d) => /^chromium-\d+$/.test(d))}/chrome-linux64/chrome`;

if (
  spawnSync('pnpm', ['--filter', '@tomoni/web', 'exec', 'next', 'build'], {
    cwd: repo,
    stdio: 'ignore',
    env: { ...process.env, API_ORIGIN },
  }).status !== 0
)
  throw new Error('web build failed');
const procs = [
  spawn('pnpm', ['--filter', '@tomoni/api', 'start'], {
    cwd: repo,
    stdio: 'ignore',
    env: {
      ...process.env,
      API_PORT: '4001',
      LOG_LEVEL: 'warn',
      TOMONI_ALLOWED_ORIGINS: WEB,
      TOMONI_QUEUE_PREFIX: 'perf',
    },
  }),
  spawn('pnpm', ['--filter', '@tomoni/web', 'exec', 'next', 'start', '-p', '3001'], {
    cwd: repo,
    stdio: 'ignore',
    env: { ...process.env, API_ORIGIN },
  }),
];
const up = async (url: string) => {
  for (let i = 0; i < 90; i++) {
    if (
      await fetch(url).then(
        (r) => r.ok,
        () => false,
      )
    )
      return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} did not start`);
};
try {
  await up('http://127.0.0.1:4001/api/system/health');
  await up(`${WEB}/login`);
  const login = await fetch(`${WEB}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB },
    body: JSON.stringify({ email: 'asha@demo.tomoni.test', password: DEMO_PASSWORD }),
  });
  if (!login.ok) throw new Error(`login ${login.status}`);
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const runs = [1, 2, 3].map((n) => {
    const file = `${out}/family-${n}.json`;
    const lh = spawnSync(
      'pnpm',
      [
        'dlx',
        'lighthouse@13.6.0',
        `${WEB}/family`,
        `--chrome-path=${chrome}`,
        '--chrome-flags=--headless=new --no-sandbox',
        `--extra-headers=${JSON.stringify({ Cookie: cookie })}`,
        '--only-categories=performance,accessibility',
        '--output=json',
        `--output-path=${file}`,
        '--quiet',
      ],
      { stdio: 'ignore', env: { ...process.env, TMPDIR: `${out}/tmp` } },
    );
    if (lh.status !== 0) throw new Error('lighthouse failed');
    const r = JSON.parse(readFileSync(file, 'utf8'));
    if (!r.finalDisplayedUrl.endsWith('/family')) throw new Error('audited a redirect, not the card');
    const score = (k: string) => Math.round(r.categories[k].score * 100);
    return { performance: score('performance'), accessibility: score('accessibility') };
  });
  const median = runs.sort((a, b) => a.performance - b.performance)[1]!;
  console.warn(JSON.stringify({ runs, median }));
  const scores = median;
  process.exitCode = Object.values(scores).every((s) => s >= 90) ? 0 : 1;
} finally {
  for (const p of procs) p.kill('SIGTERM');
}
