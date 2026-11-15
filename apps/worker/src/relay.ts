/**
 * Transactional outbox → Redis pub/sub (ARCHITECTURE "Jobs"). Rows are written in the same
 * transaction as the change they announce; this relay publishes them after commit. LISTEN gives
 * sub-second latency; a sweep every 5 s catches anything a dropped connection missed.
 * Payloads carry ids and types only, never PHI.
 */
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import { pool } from '@tomoni/db';

import { EVENTS_CHANNEL } from '@tomoni/contracts';
export { EVENTS_CHANNEL };

export async function startRelay(redis: Redis, queue: Queue): Promise<() => Promise<void>> {
  let busy = false;
  let again = false;
  const flush = async () => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        const { rows } = await pool('worker').query<{
          id: string;
          topic: string;
          aggregate_type: string;
          aggregate_id: string;
          practice_id: string | null;
          household_id: string | null;
          payload: Record<string, unknown>;
        }>(
          `UPDATE care.outbox SET published_at = now()
            WHERE id IN (SELECT id FROM care.outbox WHERE published_at IS NULL ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED)
            RETURNING id, topic, aggregate_type, aggregate_id, practice_id, household_id, payload`,
        );
        for (const r of rows.sort((a, b) => Number(a.id) - Number(b.id)))
          await redis.publish(
            EVENTS_CHANNEL,
            JSON.stringify({
              id: Number(r.id),
              topic: r.topic,
              aggregateType: r.aggregate_type,
              aggregateId: r.aggregate_id,
              practiceId: r.practice_id,
              householdId: r.household_id,
              payload: r.payload,
            }),
          );
        // Emergencies also go to the family by text (rule 2.1), whatever channel raised them.
        for (const r of rows)
          if (r.topic === 'flag.created' && r.payload.urgency === 1)
            await queue.add(
              'notify.family',
              { flagId: r.aggregate_id },
              { jobId: `notify-${r.aggregate_id}` },
            );
        if (rows.length === 500) again = true;
      } while (again);
    } finally {
      busy = false;
    }
  };

  // LISTEN on a dedicated connection that comes back by itself: the database may not exist yet
  // (CI creates it after the stack starts) or may restart under us.
  let listener: { query(q: string): Promise<unknown>; release(destroy?: boolean): void } | null = null;
  let stopped = false;
  const listen = async (): Promise<void> => {
    try {
      const c = await pool('worker').connect();
      c.on('notification', () => void flush().catch((e) => console.error('relay', (e as Error).message)));
      c.on('error', () => {
        c.release(true);
        listener = null;
        if (!stopped) setTimeout(() => void listen(), 2000);
      });
      await c.query('LISTEN tomoni_outbox');
      listener = c;
      await flush();
    } catch (e) {
      console.error('relay: waiting for the database:', (e as Error).message.slice(0, 120));
      if (!stopped) setTimeout(() => void listen(), 2000);
    }
  };
  await listen();
  const sweep = setInterval(() => void flush().catch(() => {}), 5000);
  return async () => {
    stopped = true;
    clearInterval(sweep);
    await listener?.query('UNLISTEN tomoni_outbox').catch(() => {});
    listener?.release();
  };
}
