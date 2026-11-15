import { closePools, ensureDatabase, migrate, reset } from '../src';

export default async function setup() {
  process.env.TOMONI_DB_NAME = 'tomoni_test_db';
  await ensureDatabase('tomoni_test_db');
  await reset();
  await migrate();
  await closePools();
}
