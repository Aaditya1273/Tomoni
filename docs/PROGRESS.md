# Progress

## Current state
- **Phase 1 (Foundation): done** on 2026-11-15. On GitHub's first CI run, every check passed: format, lint, typecheck, tests, Storybook, e2e, the audit and gitleaks. The security job was still marked failed, because setup-node's cache post-step failed on a job that never installs; that is fixed.
- **Phase 2 (Medicines core): done** on 2026-11-15. Definition of Done:
  - Seeded households show correct, sourced warnings. Raj and Kokila carry the scripted problems; every warning names a fill or a data file version and links to its evidence.
  - The end-to-end tests pass: 44/44, desktop and mobile, with axe WCAG 2.2 AA on every new screen.
  - §6 target met: the engine reprocesses 10,000 patients in about 1 s (budget 5 minutes). Run `pnpm --filter @tomoni/seed bench`.
- **Phase 3 (Voice and agent): done** on 2026-11-15. Definition of Done:
  - A simulated call with a symptom puts a nurse flag on the desk live in **92 ms** (budget 5 s; e2e `calls.spec.ts`).
  - The emergency-phrase tests pass in every shipped language: en, hi, gu, ta, pa and bn, native script and Latin spelling (`packages/core/test/safety.test.ts`).
- **Phase 4 (Doctor desk and APCM): done** on 2026-11-15. Definition of Done: the "one week in Tomoni" scenario runs end to end in Playwright (`e2e/one-week.spec.ts`):
  - The daily call ends with "yes, help me", the doctor signs, and the family sees it done.
  - A symptom is called back and resolved.
  - A sibling joins.
  - The care plan is signed and the month is billable.
  - Asha reads the week.
- **Phase 4b (India bridge): done.** 4b.3: the India call. 112 and Tele-MANAS instead of 911 and 988, an opening that says the family set the call up, and a yes on the call asks the family to help, live on their card (D-031). Families also update the card or cancel at the end of the paid month themselves (Stripe's customer portal). 4b.2: the family plan. Priya turns on daily calls through a (mock) checkout, end to end in Playwright; signed Stripe webhooks activate, renew, mark past-due and cancel; India calls are scheduled only with a live plan (D-030). A family abroad sees sourced warnings for a parent in India and adds medicines from the bill with a photo, end to end in Playwright (`e2e/india.spec.ts`). Still to come: the legal checks in D-027 before any India call.
- **Phase 5 (Research core): done** on 2026-11-15. Definition of Done:
  - Consent gating passes: no research data without active consent, and withdrawal hides it on the next statement.
  - Small-cell suppression passes: under 11 hidden, everything rounded to 5, secondary suppression, and a differencing attack fails.
  - No finder's fees passes: no column pays a clinician, and no fee unit exists for randomization.
  - The referral funnel works end to end (`e2e/research.spec.ts`).
- **Phase 6 (Voice Lab and Gene-to-Pill): done** on 2026-11-15. Definition of Done:
  - The `ResearchOnly` boundary is proven by tests: type tests (`@ts-expect-error`), a box that can't be serialized or opened outside `packages/research`, the lint fence on every care and sponsor API module, and RLS that gives the care and sponsor roles no grant on speech samples or outcome labels.
  - A CYP2C19 poor metabolizer on clopidogrel raises a doctor-only warning citing CPIC (`e2e/gene.spec.ts`). Nurses' queues and the family card never show it.
- **Phase 7 (Hardening): done** on 2026-11-15. Every §6–8 target, measured:

  | Target | Result | How |
  | --- | --- | --- |
  | Nurse flag on the desk < 5 s | 92 ms | `e2e/calls.spec.ts` |
  | Family card pushed live | Yes: actions, flags and warning changes push over SSE (gene-drug changes send nothing to the family) | `LiveRefresh`, `packages/medicines/test/db.test.ts` |
  | API read p95 < 300 ms | **125.6 ms**, 6,521 reads, 0 failures (41 users, 60 s, family + desk) | `pnpm --filter @tomoni/seed bench:api` (k6) |
  | Engine: 10,000 patients < 5 min | about 1 s | `pnpm --filter @tomoni/seed bench` |
  | Lighthouse ≥ 90, family app | performance **100**, accessibility **100** (median of 3; 88 on the first run before inlining CSS) | `pnpm --filter @tomoni/seed bench:web` |
  | Idempotent jobs, dead letters | 5 retries with backoff, then `deadLetter` log and `dlq` list/retry | `apps/worker/test/dlq.test.ts` |
  | §7 UI: tokens, themes, WCAG 2.2 AA, i18n, keyboard desk | axe on every screen in e2e; contrast test on every token pair | e2e + `packages/ui` |
  | §8 security: RLS per role, field encryption, CSRF/XSS, rate limits, PHI-free logs, injection red team, dependency scanning | Tested | `packages/db`, `apps/api`, `packages/agent`, CI audit + gitleaks |
  | §8 backups, tested | Encrypted dump, restore into a new DB, row counts and audit chain verified; runs in CI | `infra/scripts/db-backup.sh drill` |
  | Observability | OpenTelemetry traces and metrics, PHI-stripped; Grafana dashboard; eight alert rules (urgent flag unacknowledged, relay stuck, worker silent, dead letters, call failures, 5xx, p95) evaluated against live signals | `packages/telemetry`, RUNBOOK |

  RUNBOOK, GO_LIVE_CHECKLIST and the five-minute DEMO script are in `docs/`.
- **Next:** the GO_LIVE_CHECKLIST.

## Test inventory (all passing)

| Suite | Count | What it proves |
| --- | --- | --- |
| `packages/db` | 71 | Research (Phase 5): live consent gating and withdrawal, protocol suspension, consent immutability, who may consent (patient or verified representative; never staff), the sponsor role reading no table, suppression and rounding, a differencing attack, own-trial funnel, no randomization fee unit. Earlier: RLS for 9 roles on every table, including medicines, fills, warnings, Blue Button links, calls, nurse flags and actions; the disclosure and verification CHECKs; staff-only writes, admin-only uploads, household-only Medicare connection; audit chain; field encryption; no finder's-fee columns |
| `packages/medicines` | 31 | **Live card:** a family-visible warning change emits one `warning.changed` event per household, ids only; a doctor-only one emits none.  **Gene-to-Pill:** a poor metabolizer on clopidogrel raises a mismatch citing CPIC; no rule or no drug, nothing.  **Engine:** scorer boundaries; late refill and run-out; tier, removal, premium and price changes across years; PBM lists; shortages; closures; stable dedupe keys. **Loaders:** idempotent, bad CMS rows dropped and counted. **Mapping:** sandbox-shaped EOB, synthetic EOBs through the same mapper. **Ingestion:** idempotent. **Engine runs:** upsert, resolve and audit. **PBM:** mapping with drop reasons. **Real adapter:** PKCE, production refused while real data is off, never follows links off the CMS host |
| `apps/api` | 78 | India bridge: the family plan (checkout, signed and idempotent Stripe webhooks, no self-activation under RLS, past-due grace, cancel at period end that stops calls even if the final event is lost, Stripe-hosted portal only); a yes on an India call asks the family and nothing else acts. Gene-to-Pill: physician-only PGx entry, gene-drug item in the physician queue only; Voice Lab on a simulated call (sample under the pseudonym, research seconds apart, no words in the transcript).  Research and sponsor API end to end, including a family member who is not a representative being refused. Earlier: Phase 4: desk timeline per practice, draft and sign, APCM build, CSV export with formula-injection neutralized, mark billed, report, unified queue; family activity without caller words, streak with shield, single-use expiring invites. Earlier: Phase 1 auth suite; simulator (disclosure, flags, outbox, encrypted transcript, no names in call state, consent required, absent in production); desk flags per practice, acknowledge and resolve; SSE scoped per practice; Twilio webhooks (signature, disclosure in the patient's language, spoken emergency, voicemail with no PHI, TwiML escaping); actions (help, physician-only signing, household isolation, ops offshore gating). Phase 2: family card (own household only, staff refused, reads audited); evidence (claims, or both file versions with hashes; 404 across households); Blue Button connect/callback (single-use state, works without the session cookie, sync queued); admin PBM preview and upload |
| `packages/ui` | 26 | Every token pair meets WCAG contrast in both themes |
| `packages/i18n` | 16 | Complete locales match English keys; placeholders preserved |
| `packages/core` | 8 | Scope building; MFA and session policy per role |
| `packages/config` | 10 | Lint fences research code off care and sponsor surfaces; raw HTML banned |
| `packages/core` safety | 92 | Emergency, self-harm, symptom and medication-change phrases in six languages and two scripts; statements that should not flag; denials (downgraded, never dropped; self-harm never softened); zero-width, look-alike, accent, punctuation and nukta tricks; injection-shaped caller text |
| `packages/voice` | 23 (+9 live eval, opt-in) | India call: 112 and Tele-MANAS 14416, never 911 or 988; the family set the call up; a yes asks the family. Speech task: offered only with consent and after a clean call, can be skipped, safety first inside it, the LLM never hears it.  Disclosure first; normal call slots; one re-ask; emergency and self-harm end the call; a symptom skips every admin step; the LLM never sees text the matcher fired on; the LLM can add a flag, never remove one; scheduler time zones, DST, quiet hours; Twilio signature against Twilio's documented example |
| `packages/agent` | 13 | Closed registry; approval classes; no path skips approval or verification; strict inputs; the database rejects approvals from the wrong role or practice; confirm → do → verify recorded step by step; backoff then ops handoff; hostile pharmacy text stays untrusted data; plan ranking unaffected by any commission |
| `packages/care` | 7 | Chronic conditions from ICD-10; G0556/G0557/G0558; months excluded with reasons; only a physician of the practice signs; signed plans immutable; billed months frozen |
| `packages/research` | 10 | `ResearchOnly` can't be read as its contents, serialized, printed or opened from the package entry; ML contract (mock labelled, bad replies rejected, the Python service's real output parses); samples only with speech-task consent and a live call, once a day, under the pseudonym; care and sponsor roles denied; features and hospital-stay labels by the worker; withdrawal hides everything on the next statement |
| `apps/ml` | self-check | WAV energy features: duration, voiced ratio, pauses over 250 ms, level (`python3 apps/ml/features.py`, in CI) |
| `packages/telemetry` | 1 | Query strings stripped from every span attribute before export |
| `apps/worker` | 1 | A job that fails every attempt is a dead letter; listed, re-queued, then succeeds |
| `packages/trials` | 3 | Matching against closed criteria; one funnel step at a time; randomization never billable |
| `apps/web` e2e | 60 | Phase 1 suite, plus: family card wording, order and sources; fill and file evidence; Hindi card; Medicare connect (sandbox); admin maps a PBM CSV and the worker puts the change on Raj's card |

## Log

| Date | Slice | What was done | Tested | Mocked |
| --- | --- | --- | --- | --- |
| 2026-11-15 | Planning | Architecture, data model, security, roadmap, decisions | n/a | n/a |
| 2026-11-15 | 1.1–1.6 | Monorepo, infra, database, auth, UI, seed | See Phase 1 rows above | All adapters |
| 2026-11-15 | 2.1 Blue Button | OAuth2 + PKCE (sandbox), EOB → fill/claim mapper, idempotent ingestion, connect/callback, sync job | Unit, DB, API, e2e | `MockBlueButton` (CARIN-shaped EOBs) |
| 2026-11-15 | 2.2 Files | CMS Part D loader (real pipe-delimited format) + synthetic sample, drug list, pharmacies, shortage and closure notices, PBM CSV mapping UI | DB, API, e2e | Sample files are synthetic, labeled as such |
| 2026-11-15 | 2.3 Engine | Change detector, matcher, scorer; 8 warning types; upsert, resolve, audit; worker jobs (engine nightly, audit seal every 2 s) | Unit, DB, bench | — |
| 2026-11-15 | 3.1 Safety | Multilingual matcher with normalization | 92 unit | — |
| 2026-11-15 | 3.2–3.3 Calls | Calls, flags, actions, approvals schema; call state machine; Claude slot filler; versioned prompt | Unit, DB | `MockLLM` unless `TOMONI_ADAPTER_LLM=real` |
| 2026-11-15 | 3.4–3.5 Live desk | Simulator, nurse flags, outbox relay, SSE, desk queue | API, e2e (92 ms) | Simulator instead of a phone |
| 2026-11-15 | 3.6 Scheduler | Time zones and quiet hours, Twilio adapter and signed webhooks, family emergency texts | Unit, API | `MockTelephony` |
| 2026-11-15 | 3.7 Agent | Skill registry, approvals (DB-enforced), runner with retries and ops handoff, neutral plan ranking, family/desk/ops UI | Unit, DB, API, e2e | Pharmacy portal and e-prescribing |
| 2026-11-15 | 4.1 APCM | Care plans (physician-only signing, immutable), APCM month records with evidence, CSV export, practice report | Unit, DB, API, e2e | — |
| 2026-11-15 | 4.2 Desk queue | Keyboard-first queue (j/k/s/x/Shift+S) with evidence pane | API, e2e | — |
| 2026-11-15 | 4.3–4.4 Family | Activity log, streaks, invites; one-week scenario | API, e2e | — |
| 2026-11-15 | 5.1 Research core | Consent, pseudonyms, Trial Bridge schema, sponsor aggregate functions | 12 DB | — |
| 2026-11-15 | 5.2–5.3 Trial Bridge | Matching, registry consent page, doctor introductions, coordinator funnel, sponsor portal | Unit, API, e2e | — |
| 2026-11-15 | 4b.1 India bridge | Region per household; family-entered medicines with encrypted photo evidence; engine on family entries; India demo household | API, e2e | Local object store until S3 |
| 2026-11-15 | 6.1 Gene-to-Pill | PGx results entered by the practice; CPIC level A rules; gene-drug warnings in the physician queue only | Unit, API, e2e | — |
| 2026-11-15 | 6.2 Voice Lab | `packages/research` (`ResearchOnly<T>`, feature contract, nightly jobs), optional speech task on the call, research seconds apart from care seconds, `apps/ml` feature service | Unit, DB, API | `MockFeatureService` unless `TOMONI_ADAPTER_FEATURES=real` |
| 2026-11-15 | 7.1 Performance | k6 read-latency and Lighthouse gates against seeded stacks; CSS inlined | k6, Lighthouse | — |
| 2026-11-15 | 7.2 Operations | Dead letters, encrypted backups with a CI restore drill, OpenTelemetry, RUNBOOK, GO_LIVE_CHECKLIST, DEMO | Unit, drill | — |
| 2026-11-15 | 4b.2 Family plan | Subscription table (family starts, only a verified webhook activates), Stripe Checkout and webhooks, mock checkout, call gating, plan card in English and Hindi | API, e2e + axe | `MockBilling` unless `TOMONI_ADAPTER_BILLING=real` |
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
- **An open desk tab would have kept a clinical session alive forever.** The SSE heartbeat called the session lookup, which refreshes idle time. It now uses `auth.session_alive()`, which doesn't (0008).
- **The "disclosure first" CHECK never fired mid-call.** `outcome IN (...)` is NULL while a call is in progress, and a NULL CHECK passes. Fixed in 0009, found by a new RLS test.
- **A second approval was invisible.** A pharmacy closure with two medicines makes two transfers, each needing the family's tap, but the card showed only the latest action, so the other could never be approved. Every action now shows; the e2e approves both.
- **Two turns of one call could both apply,** and the LLM held a database transaction open for up to 8 s per live call. A turn is now two short transactions with the model in between, and the write refuses (409 `busy`) if another turn landed first. Proven by a slow-model race test that failed on the old code.
- **Twilio webhook writes never committed.** The handler returned the Fastify reply (a thenable) from inside the transaction. The TwiML is now built inside the transaction and sent after commit.

## Known gaps
- **Performance numbers are from one laptop.** Production needs its own k6 run on production-sized data and hardware, and the Lighthouse run covers the family card only (the desk is keyboard-first and not scored).
- **TLS, encryption at rest and point-in-time recovery** belong to the hosting setup and are on the GO_LIVE_CHECKLIST; locally everything runs over plain http.
- **Alerts go to one webhook.** Eight rules and the routing are provisioned (RUNBOOK "Alerts"); the pager, the rota and escalation tiers are a hosting decision (GO_LIVE_CHECKLIST).
- **Speech-task audio is built but off** (`TOMONI_SPEECH_AUDIO`, D-032), and untested against Twilio itself, like the rest of telephony. The simulator captures no audio, so simulator samples get labelled mock features. Counsel must also confirm D-009 (research inside a billed care call).
- **Outcome labels cover hospital stays only.** ED visits and new diagnoses need claim types the mapper doesn't produce yet.
- **The voice pre-screen** (ethics-approved questions on the daily call) is not built; the doctor can introduce from a match directly. It arrives with Phase 6's call changes.
- **The research protocol summary** is complete in English and Hindi only, and is a demo text; a real one comes from the IRB-approved consent document.
- **Sponsor usage shows exact unit counts** because it is an invoice. It names no one, but together with a small funnel it can reveal that one person progressed. Counsel should confirm (add to D-010 review).
- **Care-plan goals are templates** for common conditions; the physician edits by drafting a new version (no inline editor yet).
- **APCM rates in the report are national**; local adjustments (GPCI) are not applied.
- **Live LLM eval not run.** No Anthropic credentials on this machine. Run `pnpm --filter @tomoni/voice eval` with credentials before turning on `TOMONI_ADAPTER_LLM=real`.
- **Real telephony is untested against Twilio.** The adapter and signed webhooks are built and tested against Twilio's documented signature example only. Speech-to-text uses Twilio's built-in recognition until the vendor decision (D-007).
- **Call scripts for gu, ta, pa and bn** fall back to English (D-025). All new Hindi needs native review.
- **No real pharmacy or e-prescribing partner.** Every agent action runs against labeled mocks. A real partner (Surescripts-certified) is a Go-Live item.
- **Real Blue Button sandbox not exercised end to end.** It needs client credentials from the CMS developer sandbox (`TOMONI_BB_CLIENT_ID` / `SECRET`, `TOMONI_ADAPTER_BLUEBUTTON=real`). The adapter is tested against a fake server.
- **No full CMS release loaded yet.** The loader reads the real file format, but only the bundled synthetic sample has been loaded. A full release (gigabytes, plus the pharmacy network file, which isn't loaded at all) needs a streaming loader before production.
- **Run-out warnings depend on knowing refills.** Real PDE data rarely has them (D-018). The Phase 3 refill-status skill fills that gap.
- **Medicine names** are simplified from RxNorm by a heuristic.
- **Hindi copy:** the new strings also need native review. The other four Indic locales fall back to English.
- **Family navigation:** still one page plus evidence. The activity log and family pages come in Phase 4.
- **Warning thresholds** need founder review (D-019).
- **Open decisions:** D-007 to D-011, D-014 and D-019.

## Next
Work the GO_LIVE_CHECKLIST with counsel, the IRB and a clinical reviewer. In code, the remaining items are in Known gaps.
