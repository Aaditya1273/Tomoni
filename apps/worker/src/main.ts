/**
 * Background jobs (BUILD_PROMPT §3): audit sealing, Blue Button sync, the warning engine.
 * Runs on the tomoni_worker DB role. Logs carry job names, ids and counts only, never PHI.
 */
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { JOB_DEFAULTS, JobPayloads, QUEUE, type JobName } from '@tomoni/contracts';
import { closePools, env } from '@tomoni/db';
import { handlers } from './handlers';

const connection = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue(QUEUE, { connection, defaultJobOptions: JOB_DEFAULTS });

// Seal the audit chain every 2 seconds; rerun the engine for everyone every morning.
await queue.upsertJobScheduler('audit-seal', { every: 2000 }, { name: 'audit.seal', data: {} });
await queue.upsertJobScheduler(
  'engine-nightly',
  { pattern: '0 5 * * *', tz: 'America/New_York' },
  { name: 'engine.run', data: {} },
);

const worker = new Worker(
  QUEUE,
  async (job: Job) => {
    if (!Object.hasOwn(JobPayloads, job.name)) throw new Error(`unknown job ${job.name}`);
    const name = job.name as JobName;
    const run = handlers[name] as (d: unknown) => Promise<unknown>;
    return run(JobPayloads[name].parse(job.data));
  },
  { connection, concurrency: 4 },
);
worker.on('completed', (job, result) => {
  if (job.name !== 'audit.seal' || (result as { sealed?: number })?.sealed)
    console.warn(JSON.stringify({ job: job.name, id: job.id, result }));
});
worker.on('failed', (job, err) =>
  console.error(
    JSON.stringify({
      job: job?.name,
      id: job?.id,
      attempt: job?.attemptsMade,
      error: err.message.slice(0, 200),
    }),
  ),
);

console.warn(`worker listening on queue "${QUEUE}"`);
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    await worker.close();
    await queue.close();
    connection.disconnect();
    await closePools();
    process.exit(0);
  });
