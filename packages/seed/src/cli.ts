import { closePools } from '@tomoni/db';
import { seed } from './seed';

try {
  await seed((m) => console.warn(m), { force: process.argv.includes('--force') });
} finally {
  await closePools();
}
