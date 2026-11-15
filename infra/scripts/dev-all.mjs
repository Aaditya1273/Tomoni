// One-command local start (BUILD_PROMPT §3): env → Postgres + Redis → migrate → seed → all apps.
import { execSync, spawn } from 'node:child_process';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

run('node infra/scripts/setup-env.mjs');
run('docker compose -f infra/docker-compose.yml up -d --wait');
run('pnpm db:migrate');
run('pnpm db:seed'); // no-op when already seeded

console.warn(`
  Tomoni is starting:
    family / desk / ops   http://localhost:3000
    sponsor portal        http://localhost:3100
    API + OpenAPI docs    http://localhost:4000/docs
  Demo logins are in README.md. Ctrl+C stops the apps (containers keep running: pnpm infra:down).
`);

const child = spawn(
  'pnpm',
  [
    'turbo',
    'run',
    'dev',
    '--filter=@tomoni/api',
    '--filter=@tomoni/web',
    '--filter=@tomoni/sponsor',
    '--ui=stream',
  ],
  { stdio: 'inherit' },
);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
