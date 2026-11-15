import { closePools } from './client';
import { migrate, reset } from './migrate';

const cmd = process.argv[2];
try {
  if (cmd === 'migrate') {
    const ran = await migrate((m) => console.warn(m));
    console.warn(ran.length ? `${ran.length} migration(s) applied` : 'schema up to date');
  } else if (cmd === 'seed') {
    const { seed } = await import('../seed/seed');
    await seed((m) => console.warn(m), { force: process.argv.includes('--force') });
  } else if (cmd === 'reset') {
    await reset();
    await migrate((m) => console.warn(m));
  } else {
    throw new Error('usage: cli.ts migrate|reset|seed');
  }
} finally {
  await closePools();
}
