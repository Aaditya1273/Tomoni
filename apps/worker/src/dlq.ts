/**
 * Dead letters (BUILD_PROMPT §6). A job that fails all its attempts (JOB_DEFAULTS: 5, with
 * backoff) stays in BullMQ's failed set; this lists and re-queues them. RUNBOOK "Dead letters".
 */
import type { Job, Queue } from 'bullmq';

export const isDead = (job: Job | undefined) => !!job && job.attemptsMade >= (job.opts.attempts ?? 1);

/** Job names, ids, attempts and our own error text only: payloads are ids, never PHI. */
export async function listDead(queue: Queue, limit = 100) {
  const jobs = await queue.getFailed(0, limit - 1);
  return jobs.filter(isDead).map((j) => ({
    id: j.id!,
    name: j.name,
    attempts: j.attemptsMade,
    failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
    reason: (j.failedReason ?? '').slice(0, 200),
  }));
}

/** Re-queue one dead job, or all of them. Handlers are idempotent, so a retry is safe. */
export async function retryDead(queue: Queue, id?: string) {
  const dead = id ? [await queue.getJob(id)] : await queue.getFailed(0, 999);
  let n = 0;
  for (const j of dead)
    if (j && isDead(j) && (await j.isFailed())) {
      await j.retry('failed', { resetAttemptsMade: true });
      n++;
    }
  return n;
}
