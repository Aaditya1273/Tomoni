import { closePools, ensureDatabase, migrate, reset } from '@tomoni/db';

export default async function setup() {
  process.env.TOMONI_DB_NAME = 'tomoni_test_api';
  await ensureDatabase('tomoni_test_api');
  await reset();
  await migrate();
  await closePools();
}
