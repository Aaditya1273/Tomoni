/**
 * What on-call is paged on (RUNBOOK "Alerts"), as OpenTelemetry gauges read at each export.
 * Counts and ages only, never PHI. Without OTEL_EXPORTER_OTLP_ENDPOINT the meter is a no-op and
 * the callback never runs. Rules: infra/grafana/alerts.yaml.
 */
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { systemScope } from '@tomoni/core';
import { withScope } from '@tomoni/db';
import { metrics } from '@tomoni/telemetry';

export async function readSignals(queue: Queue) {
  const deadLetters = await queue.getFailedCount(); // the failed set holds only jobs out of retries
  const { rows } = await withScope('worker', systemScope('signals'), (db) =>
    db.execute<{ outbox: number; urgent: number; flag: number; calls: number; failed: number }>(sql`
      SELECT
        coalesce(extract(epoch FROM now() - (SELECT min(created_at) FROM care.outbox WHERE published_at IS NULL)), 0)::float8 AS outbox,
        coalesce(extract(epoch FROM now() - (SELECT min(created_at) FROM care.nurse_flag
                                             WHERE status = 'open' AND urgency = 1)), 0)::float8 AS urgent,
        coalesce(extract(epoch FROM now() - (SELECT min(created_at) FROM care.nurse_flag
                                             WHERE status = 'open' AND urgency = 2)), 0)::float8 AS flag,
        count(*)::int AS calls, count(*) FILTER (WHERE outcome = 'failed')::int AS failed
        FROM care.call WHERE channel = 'voice' AND ended_at > now() - interval '1 hour'`),
  );
  const r = rows[0]!;
  return {
    deadLetters,
    outboxOldestSeconds: r.outbox,
    urgentFlagOpenSeconds: r.urgent,
    flagOpenSeconds: r.flag,
    callsLastHour: r.calls,
    callsFailedLastHour: r.failed,
  };
}

export function registerSignals(queue: Queue) {
  const m = metrics.getMeter('tomoni.worker');
  const g = {
    deadLetters: m.createObservableGauge('tomoni.jobs.dead_letters'),
    outboxOldestSeconds: m.createObservableGauge('tomoni.outbox.oldest_unpublished_seconds'),
    urgentFlagOpenSeconds: m.createObservableGauge('tomoni.flags.urgent_open_seconds'),
    flagOpenSeconds: m.createObservableGauge('tomoni.flags.open_seconds'),
    callsLastHour: m.createObservableGauge('tomoni.calls.ended_last_hour'),
    callsFailedLastHour: m.createObservableGauge('tomoni.calls.failed_last_hour'),
  };
  m.addBatchObservableCallback(async (o) => {
    const s = await readSignals(queue);
    for (const k of Object.keys(g) as (keyof typeof g)[]) o.observe(g[k], s[k]);
  }, Object.values(g));
}
