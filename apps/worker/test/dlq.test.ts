import { afterAll, expect, it } from 'vitest';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '@tomoni/db';
import { listDead, retryDead } from '../src/dlq';

const connection = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
const prefix = `dlq-test-${process.pid}`;
const queue = new Queue('t', { connection, prefix });
const events = new QueueEvents('t', { connection: connection.duplicate(), prefix });
let fail = true;
const worker = new Worker(
  't',
  async () => {
    if (fail) throw new Error('pharmacy portal down');
    return 'ok';
  },
  { connection: connection.duplicate(), prefix },
);
afterAll(async () => {
  await worker.close();
  await events.close();
  await queue.obliterate({ force: true });
  await queue.close();
  connection.disconnect();
});

it('a job that fails every attempt is a dead letter, listed and re-queued until it succeeds', async () => {
  await events.waitUntilReady();
  const job = await queue.add('action.run', { actionId: 'a1' }, { attempts: 2 });
  await expect(job.waitUntilFinished(events, 10_000)).rejects.toThrow('pharmacy portal down');
  const dead = await listDead(queue);
  expect(dead).toEqual([expect.objectContaining({ id: job.id, name: 'action.run', attempts: 2 })]);

  fail = false;
  expect(await retryDead(queue, job.id)).toBe(1);
  await expect(job.waitUntilFinished(events, 10_000)).resolves.toBe('ok');
  expect(await listDead(queue)).toEqual([]);
});
