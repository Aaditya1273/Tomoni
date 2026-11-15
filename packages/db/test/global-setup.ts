import { closePools, migrate, reset } from '../src';

export default async function setup() {
  process.env.TOMONI_DB_NAME = 'tomoni_test';
  await reset();
  await migrate();
  await closePools();
}
