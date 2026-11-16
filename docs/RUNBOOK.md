# Runbook

How to run, watch and recover Tomoni. Every command is from the repository root.

## Services

| Process | Start | Health | Notes |
| --- | --- | --- | --- |
| API (Fastify) | `pnpm --filter @tomoni/api start` | `GET /api/system/health` (DB + Redis) | Port `API_PORT` (4000). Logs are PHI-free JSON (SECURITY S13) |
| Worker (BullMQ) | `pnpm --filter @tomoni/worker start` | `TOMONI_WORKER_HEALTH_PORT` returns 200 while running | Relays the outbox to Redis and runs every job |
| Web (family, desk, ops, admin) | `pnpm --filter @tomoni/web start` | `GET /login` | Needs `API_ORIGIN` at build time (the `/api` rewrite) |
| Sponsor portal | `pnpm --filter @tomoni/sponsor start` | `GET /login` | Separate origin (D-002) |
| Postgres 18, Redis 8 | `pnpm infra:up` | Compose healthchecks | Local ports 5544 and 6390 (D-013) |
| ML features | `uvicorn app:app --port 8090` in `apps/ml` | `GET /health` | Only with `TOMONI_ADAPTER_FEATURES=real` |

`pnpm dev:all` does all of this locally with fresh keys and a synthetic seed.

## Scheduled jobs

| Job | When (America/New_York) | If it fails |
| --- | --- | --- |
| `audit.seal` | every 2 s | Unsealed audit rows wait; nothing is lost. Check `SELECT audit.verify()` (NULL means intact) |
| `engine.run` | 05:00, and after every new fill or file | Warnings go stale. Rerun with a fresh job; the run is idempotent |
| `trials.match` | 05:30 | Matches are a day late. Idempotent |
| `research.nightly` | 06:00 | Speech features and outcome labels wait. Idempotent; RLS limits it to consented people |
| `call.schedule` | every 5 min, only with `TOMONI_CALL_SCHEDULER=on` | Calls are not placed. Families and the desk see no call that day |

## Dead letters

A job retries 5 times with exponential backoff (`JOB_DEFAULTS`). After the last attempt the worker logs `"deadLetter":true` and BullMQ keeps the job in its failed set.

```sh
pnpm --filter @tomoni/worker dlq            # list: name, id, attempts, our error text (no PHI)
pnpm --filter @tomoni/worker dlq retry <id> # re-queue one; omit the id to re-queue all
```

Every handler is idempotent, so a retry is safe. Fix the cause before retrying a whole batch. Failed agent actions also go to the ops console as handoffs, so a person finishes them.

## Incidents

**An emergency flag did not reach the desk.** The path is call turn → `nurse_flag` + `outbox` row (same transaction) → worker relay → Redis → SSE. Check the worker's health first. Then look for unrelayed rows: `SELECT count(*) FROM care.outbox WHERE published_at IS NULL`. The relay reconnects on its own; a restart drains the backlog. The family text for urgency-1 flags is a `notify.family` job, so check dead letters too. In every case the caller was already told to call 911 (rule 2.1).

**A consent withdrawal.** Research withdrawal is self-service on the family research page and takes effect on the next statement (RLS). Withdrawing contact consent stops calls the same way. Never delete rows to "withdraw": the records are evidence.

**A wrong warning on a family card.** Every warning names its source, so open its evidence page first. If the source file is wrong, load a corrected version and the engine resolves the old warning. If the engine is wrong, file a bug with the evidence page; do not edit `care.warning` by hand.

**Suspected PHI in a log line.** Treat it as a security incident (SECURITY.md). The redactor is a second line of defence; find and fix the code that logged it.

## Backups

```sh
TOMONI_BACKUP_KEY=… infra/scripts/db-backup.sh backup tomoni          # backups/tomoni-<utc>.dump.enc
TOMONI_BACKUP_KEY=… infra/scripts/db-backup.sh restore <file> <newdb> # never into an existing database
TOMONI_BACKUP_KEY=… infra/scripts/db-backup.sh drill tomoni           # backup → restore → verify → drop
```

The drill compares the row count of every table and verifies the audit chain on the restored copy. It runs in CI on the e2e database. On a clean seed it takes 2 to 5 seconds. Keep the key in the secrets manager, never next to the dumps. Client tools must match the server major version; `PGTOOLS="docker run --rm -i --network host postgres:18.3"` runs them from the server image.

Production targets still to set with hosting (GO_LIVE_CHECKLIST): point-in-time recovery, off-site copies, and a quarterly restore drill.

## Observability

```sh
docker compose -f infra/docker-compose.yml --profile observability up -d   # Grafana on :3300
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 OTEL_SERVICE_NAME=tomoni-api pnpm --filter @tomoni/api start
```

Telemetry is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Spans are named by route template, never by raw path. Query strings are stripped before export, no headers are recorded, and SQL is recorded without values. The **Tomoni** dashboard shows API p95 by route, request rate by status, and database time.

## Alerts

Rules, the on-call contact point and routing are provisioned from `infra/grafana/alerts.yaml`. Set `TOMONI_ONCALL_WEBHOOK_URL` to the pager's webhook (PagerDuty, Opsgenie or Slack); `severity=page` repeats every 30 minutes until resolved, and `severity=ticket` waits for working hours. The worker reports the signals (`apps/worker/src/signals.ts`) as counts and ages only, never PHI.

| Alert | Severity | First steps |
| --- | --- | --- |
| Urgent nurse flag open over 15 minutes | page | The caller was already told to call 911 (or 112 in India). Phone the practice's on-call clinician; for India, the Tomoni India Care Team lead. Then check that the flag reached the desk (below). |
| Nurse flag open over 4 hours | page | The patient was promised a call back today. Phone the practice's nurse line. |
| Live events not relayed for 2 minutes | page | Flags and family cards are not updating live. Check the worker's health and Redis, then restart the worker; the relay drains the backlog. |
| Worker signals missing | page | The worker is down or can't reach the collector. Restart it, then check the outbox and dead letters. |
| Jobs in the dead-letter set | ticket | `pnpm --filter @tomoni/worker dlq` lists them; fix the cause, then `dlq retry`. Handlers are idempotent. |
| Over 20% of phone calls failing | page | Check Twilio's status page, the voice webhook logs (signature failures return 403), and `TOMONI_PUBLIC_ORIGIN`. |
| API 5xx over 2% | page | Check the API logs by request id and the database. Roll back the last deploy if it started with it. |
| API read p95 over 300 ms | ticket | The dashboard shows which route; the pg panel shows whether it is the database. |

To test the path end to end, run the observability profile and a worker with `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 OTEL_METRIC_EXPORT_INTERVAL=5000`. Rules appear under Alerting → Tomoni, and any dead letter in the dev queue turns "Jobs in the dead-letter set" pending within a minute.

## Performance checks (§6)

| Target | Command | Last measured (2026-11-15, laptop) |
| --- | --- | --- |
| Nurse flag on the desk < 5 s | `e2e/calls.spec.ts` | 92 ms |
| API read p95 < 300 ms | `pnpm --filter @tomoni/seed bench:api` (k6, 41 users, 60 s) | 125.6 ms over 6,521 reads, 0 failures |
| Engine: 10,000 patients < 5 min | `pnpm --filter @tomoni/seed bench` | about 1 s |
| Lighthouse ≥ 90 (family app) | `pnpm --filter @tomoni/seed bench:web` (median of 3) | performance 100, accessibility 100 |
