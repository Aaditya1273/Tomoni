import { closePools, ensureDatabase, migrate, reset } from '@tomoni/db';

export default async function setup() {
  process.env.TOMONI_DB_NAME = 'tomoni_test_trials';
  await ensureDatabase('tomoni_test_trials');
  await reset();
  await migrate();
  await closePools();
}
