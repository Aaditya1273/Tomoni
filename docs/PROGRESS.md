# Progress

## Current state
- **Phase 1 (Foundation): done** on 2026-11-15. On GitHub's first CI run, every check passed: format, lint, typecheck, tests, Storybook, e2e, the audit and gitleaks. The security job was still marked failed, because setup-node's cache post-step failed on a job that never installs; that is fixed.
- **Phase 2 (Medicines core): done** on 2026-11-15. Definition of Done:
  - Seeded households show correct, sourced warnings. Raj and Kokila carry the scripted problems; every warning names a fill or a data file version and links to its evidence.
  - The end-to-end tests pass: 44/44, desktop and mobile, with axe WCAG 2.2 AA on every new screen.
  - §6 target met: the engine reprocesses 10,000 patients in about 1 s (budget 5 minutes). Run `pnpm --filter @tomoni/seed bench`.
- **Next: Phase 3 (Voice and agent).**

## Test inventory (all passing)

| Suite | Count | What it proves |
| --- | --- | --- |
| `packages/db` | 48 | RLS for 9 roles on every table, including medicines, fills, warnings and Blue Button links; staff-only writes, admin-only uploads, household-only Medicare connection; audit chain; field encryption; no finder's-fee columns |
| `packages/medicines` | 28 | **Engine:** scorer boundaries; late refill and run-out; tier, removal, premium and price changes across years; PBM lists; shortages; closures; stable dedupe keys. **Loaders:** idempotent, bad CMS rows dropped and counted. **Mapping:** sandbox-shaped EOB, synthetic EOBs through the same mapper. **Ingestion:** idempotent. **Engine runs:** upsert, resolve and audit. **PBM:** mapping with drop reasons. **Real adapter:** PKCE, production refused while real data is off, never follows links off the CMS host |
| `apps/api` | 30 | Phase 1 auth suite, plus: family card (own household only, staff refused, reads audited); evidence (claims, or both file versions with hashes; 404 across households); Blue Button connect/callback (single-use state, works without the session cookie, sync queued); admin PBM preview and upload |
| `packages/ui` | 26 | Every token pair meets WCAG contrast in both themes |
| `packages/i18n` | 16 | Complete locales match English keys; placeholders preserved |
| `packages/core` | 8 | Scope building; MFA and session policy per role |
| `packages/config` | 8 | Lint fences research code off care and sponsor surfaces; raw HTML banned |
| `apps/web` e2e | 44 | Phase 1 suite, plus: family card wording, order and sources; fill and file evidence; Hindi card; Medicare connect (sandbox); admin maps a PBM CSV and the worker puts the change on Raj's card |

## Log

| Date | Slice | What was done | Tested | Mocked |
| --- | --- | --- | --- | --- |
| 2026-11-15 | Planning | Architecture, data model, security, roadmap, decisions | n/a | n/a |
| 2026-11-15 | 1.1–1.6 | Monorepo, infra, database, auth, UI, seed | See Phase 1 rows above | All adapters |
| 2026-11-15 | 2.1 Blue Button | OAuth2 + PKCE (sandbox), EOB → fill/claim mapper, idempotent ingestion, connect/callback, sync job | Unit, DB, API, e2e | `MockBlueButton` (CARIN-shaped EOBs) |
| 2026-11-15 | 2.2 Files | CMS Part D loader (real pipe-delimited format) + synthetic sample, drug list, pharmacies, shortage and closure notices, PBM CSV mapping UI | DB, API, e2e | Sample files are synthetic, labeled as such |
| 2026-11-15 | 2.3 Engine | Change detector, matcher, scorer; 8 warning types; upsert, resolve, audit; worker jobs (engine nightly, audit seal every 2 s) | Unit, DB, bench | — |
| 2026-11-15 | 2.4 Family card | Card with Access Scores and sourced warnings, evidence page, admin data page; English + Hindi | API, e2e + axe | — |

## Found and fixed by the tests
- **Session hooks never applied.** They were registered as an encapsulated Fastify plugin.
- **A pooled connection leaked a user id.** Replaced by `auth.user_grants()`.
- **Per-IP rate limits would lock out clinics** (D-015).
- **A submit before hydration could put the password in the URL.**
- **Redirect loop in the sponsor portal.**
- **Admins landed on a blank page.** `/desk` is not an admin surface, and the landing test only checked the URL. Admins now land on `/admin/data`, and the test checks that the page renders.
- **Monthly noise:** "runs out in 10 days" fired for every medicine every month. Fixed by D-018, and price rises now need both thresholds (D-019).
- **Drizzle expands JS arrays in SQL templates into lists.** Array parameters now go through `sql.param`.

## Known gaps
- **Real Blue Button sandbox not exercised end to end.** It needs client credentials from the CMS developer sandbox (`TOMONI_BB_CLIENT_ID` / `SECRET`, `TOMONI_ADAPTER_BLUEBUTTON=real`). The adapter is tested against a fake server.
- **No full CMS release loaded yet.** The loader reads the real file format, but only the bundled synthetic sample has been loaded. A full release (gigabytes, plus the pharmacy network file, which isn't loaded at all) needs a streaming loader before production.
- **Run-out warnings depend on knowing refills.** Real PDE data rarely has them (D-018). The Phase 3 refill-status skill fills that gap.
- **No live updates yet.** The family card updates on reload. The outbox relay and SSE arrive with Phase 3.
- **Medicine names** are simplified from RxNorm by a heuristic.
- **Hindi copy:** the new strings also need native review. The other four Indic locales fall back to English.
- **Family navigation:** still one page plus evidence. The activity log and family pages come in Phase 4.
- **Warning thresholds** need founder review (D-019).
- **Open decisions:** D-007 to D-011, D-014 and D-019.

## Next
Phase 3, slice 3.1: contact consent and the call scheduler (time zones, quiet hours, AI disclosure), then the multilingual safety matcher.
