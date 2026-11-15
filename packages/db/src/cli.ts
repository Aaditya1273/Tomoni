import { closePools } from './client';
import { migrate, reset } from './migrate';

const cmd = process.argv[2];
try {
  if (cmd === 'migrate') {
    const ran = await migrate((m) => console.warn(m));
    console.warn(ran.length ? `${ran.length} migration(s) applied` : 'schema up to date');
  } else if (cmd === 'reset') {
    await reset();
    await migrate((m) => console.warn(m));
  } else {
    throw new Error('usage: cli.ts migrate|reset');
  }
} finally {
  await closePools();
}
