// pnpm --filter @tomoni/worker dlq [retry [<job id>]]
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE } from '@tomoni/contracts';
import { env } from '@tomoni/db';
import { listDead, retryDead } from './dlq';

const connection = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue(QUEUE, { connection, prefix: process.env.TOMONI_QUEUE_PREFIX ?? 'bull' });
const [cmd, id] = process.argv.slice(2);
if (cmd === 'retry') console.warn(`re-queued ${await retryDead(queue, id)} job(s)`);
else console.warn(JSON.stringify(await listDead(queue), null, 2));
await queue.close();
connection.disconnect();
