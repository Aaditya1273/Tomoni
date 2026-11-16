import { afterAll, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import { closePools, env, ownerDb } from '@tomoni/db';
import { readSignals } from '../src/signals';

const connection = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue('t', { connection, prefix: `signals-test-${process.pid}` });
afterAll(async () => {
  await queue.obliterate({ force: true });
  await queue.close();
  connection.disconnect();
  await closePools();
});

it('reports a stuck outbox row by age, and nothing once it is relayed', async () => {
  const db = ownerDb();
  expect(await readSignals(queue)).toMatchObject({
    deadLetters: 0,
    outboxOldestSeconds: 0,
    callsLastHour: 0,
  });
  await db.execute(sql`INSERT INTO care.outbox (topic, aggregate_type, aggregate_id, created_at)
    VALUES ('flag.created', 'nurse_flag', gen_random_uuid(), now() - interval '10 minutes')`);
  expect((await readSignals(queue)).outboxOldestSeconds).toBeGreaterThanOrEqual(600);
  await db.execute(sql`UPDATE care.outbox SET published_at = now()`);
  expect((await readSignals(queue)).outboxOldestSeconds).toBe(0);
});
