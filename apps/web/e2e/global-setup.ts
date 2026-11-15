import { closePools, ensureDatabase, migrate, reset } from '@tomoni/db';
import { seed } from '@tomoni/seed';
import { resetMfaState } from './helpers';

export default async function globalSetup() {
  process.env.TOMONI_DB_NAME = 'tomoni_e2e';
  Object.assign(process.env, { NODE_ENV: 'test' });
  await ensureDatabase('tomoni_e2e');
  await reset();
  await migrate();
  await seed();
  resetMfaState(); // fresh DB = nobody enrolled yet
  await closePools();
}
