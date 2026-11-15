# Decisions

Each entry records the options, the choice and the reason. `NEEDS-FOUNDER-REVIEW` means a safe default was picked so the build could continue, but the founder (and usually counsel) must confirm it.

| ID | Decision | Status |
| --- | --- | --- |
| D-001 | Stack as specified: pnpm + Turborepo, Next.js, Fastify, Postgres, BullMQ, FastAPI | Accepted |
| D-002 | Two web apps: `web` (family, desk, ops) and `sponsor` | Accepted |
| D-003 | Drizzle over Prisma | Accepted |
| D-004 | SSE over WebSockets | Accepted |
| D-005 | App-level AES-256-GCM instead of pgcrypto for PHI fields | Accepted (deviation from spec) |
| D-006 | First-party auth, OIDC-ready, instead of an external IdP | Accepted |
| D-007 | STT/TTS vendor | NEEDS-FOUNDER-REVIEW |
| D-008 | Offshore ops access to PHI off by default per practice | NEEDS-FOUNDER-REVIEW |
| D-009 | Research call time recorded separately from APCM care time | NEEDS-FOUNDER-REVIEW |
| D-010 | No per-randomized-participant fee unit | NEEDS-FOUNDER-REVIEW |
| D-011 | Blue Button–sourced data excluded from data licensing exports | NEEDS-FOUNDER-REVIEW |
| D-012 | Own deterministic seed generator instead of Synthea | Accepted |
| D-013 | Local ports moved off 5432/5433/8080 | Accepted |
| D-014 | Building software during the manual-validation phase | NEEDS-FOUNDER-REVIEW |
| D-015 | Rate limits keyed per session and per (IP, account) | Accepted |
| D-016 | Self-hosted Anek fonts instead of `next/font/google` | Accepted |
| D-017 | TypeScript 6.0, not 7 | Accepted |
| D-018 | Run-out warnings only when refills are known to be zero | Accepted |
| D-019 | What counts as a warning: thresholds and time windows | NEEDS-FOUNDER-REVIEW |
| D-020 | Blue Button callback bound by state, not the session cookie | Accepted |
| D-021 | Mock Blue Button data is a snapshot as of the connection date | Accepted |
| D-022 | Seed in its own package | Accepted |
| D-023 | Conversation LLM: Claude Opus 5.5 at low effort, structured output, no fallback model | Accepted |
| D-024 | Daily-call scheduler is opt-in per environment | Accepted |
| D-025 | Calls in Gujarati, Tamil, Punjabi and Bengali speak English until native scripts exist | NEEDS-FOUNDER-REVIEW |
| D-026 | Agent code in `packages/agent`, safety matcher in `packages/core` | Accepted |
| D-027 | Second market: the India bridge, family-paid, research opening after 13 May 2027 | NEEDS-FOUNDER-REVIEW |

## D-002: Two web apps, not four
Options: (a) four Next.js apps, one per surface; (b) one app for everything; (c) one PHI app plus a separate sponsor app.
**Chosen: (c).** Family, desk and ops share the same PHI, auth model and design system, so splitting them adds three build pipelines and no isolation. The sponsor portal is different: it must never be able to render PHI. On its own origin it gets its own cookies and CSP, and it can reach only `/sponsor-api/*`, which runs on a DB role with no PHI grants.

## D-003: Drizzle over Prisma; migrations are hand-written SQL
Drizzle is the typed query layer only. Migrations are plain SQL files (`packages/db/migrations/NNNN_*.sql`) applied by a small checksumming migrator, so a migration can't be edited after it has run. The RLS policies, `SECURITY DEFINER` functions, triggers and `SET LOCAL ROLE` per transaction are all hand-written SQL. Drizzle's SQL-first migrations and plain `pg` transactions make those first-class. Prisma's connection and transaction model makes per-transaction role and GUC switching awkward.

## D-004: SSE over WebSockets
All real-time traffic is server → client: flags, card updates, queue changes. SSE reconnects by itself, passes through proxies, and runs over the same cookie-authenticated HTTP. Upgrade to WebSockets only if a surface ever needs client → server streaming (the call simulator uses plain POST plus SSE).

## D-005: App-level encryption instead of pgcrypto (deviates from §3)
With `pgp_sym_encrypt`, the key is sent inside SQL. It can then show up in `pg_stat_statements`, slow-query logs and error messages, and anyone who can read the DB together with its logs gets both ciphertext and key. Encrypting in the app (AES-256-GCM, Node `crypto`, a keyring with key ids) keeps keys out of the database, maps directly onto a KMS envelope scheme later, and is just as fast. pgcrypto is still used where it fits: `digest()` for the audit hash chain.

## D-006: First-party auth, OIDC-ready
There is no IdP to integrate with yet, and the role and scope model is specific to Tomoni. Accounts, argon2id, TOTP and sessions are built in the API. An `auth.identity(provider, subject)` table means adding OIDC later (for practices with Google Workspace or Entra) is a new adapter, not a migration.

## D-007: Speech-to-text and text-to-speech vendor (NEEDS-FOUNDER-REVIEW)
Indian-language quality varies widely by vendor, and each one needs a BAA. Phase 3 ships the interface plus `MockSpeech`. Before choosing, run a bake-off on Hindi, Gujarati and Tamil recordings from the manual phase. Candidates: Google Cloud Speech (Chirp), Azure Speech, Deepgram, Sarvam AI (India-hosted, which raises data-residency questions).

## D-008: Offshore ops access to PHI off by default (NEEDS-FOUNDER-REVIEW)
The plan has an India operations team handling escalations and making calls. Two legal questions are open:
- Whether care-management services billed to Medicare may be performed by staff outside the US.
- Whether practices and plans permit offshore PHI access. CMS requires Medicare Advantage organizations to report offshore subcontractors.

Default: `practice.offshore_ops_access = false`. When it's off, the `ops_agent` role sees no PHI for that practice. When it's on, the role sees minimum-necessary fields only, and every view is audited. Counsel must confirm before any practice turns it on.

## D-009: Research call time kept apart from APCM care time (NEEDS-FOUNDER-REVIEW)
The research speech task happens inside a call the practice may bill under APCM. Time spent on research must not count as care. `call.care_seconds` and `call.research_seconds` are recorded separately, and APCM evidence exports include only care time. Counsel should confirm whether research tasks may run inside a billed care call at all, or need a separate call.

## D-010: No per-randomized-participant fee unit (NEEDS-FOUNDER-REVIEW)
The life-science plan prices Trial Bridge partly "per randomized participant". The patient's own doctor introduces the trial, and that practice already has a commercial relationship with Tomoni. A fee contingent on randomization looks like the success-based recruitment payment that anti-kickback guidance warns about.

Default: the `service_rate.unit` enum has work-based units only (pre-screen completed, introduction delivered, consent-prep call, retention participant-month, study hours, feasibility report). Adding `randomized_participant` takes a migration plus counsel sign-off.

## D-011: Blue Button data excluded from data licensing (NEEDS-FOUNDER-REVIEW)
Blue Button 2.0 developer terms restrict how apps may use and share beneficiary data. Licensing cohort data that includes claims obtained through Blue Button needs a legal reading first. Default: every row carries its `source`, and the future data-licensing export refuses `source = 'bluebutton'` rows unless `TOMONI_BB_LICENSING_APPROVED=true`.

## D-012: Own seed generator instead of Synthea
Synthea needs a JVM. Its output is US-English and doesn't include the scripted households the demo needs (Raj, a CYP2C19 poor metabolizer on clopidogrel, a planted tier change). A deterministic TypeScript generator with a seeded PRNG produces the same 500 patients on every machine and in CI, and can be read in full. Synthea-shaped EOB JSON is still what `MockBlueButton` returns, so switching to real Synthea output later is only a data swap.

## D-013: Local ports
5433 and 8080 are already in use on the dev machine by another project. Tomoni uses Postgres 5544, Redis 6390, API 4000, web 3000, sponsor 3100, ML 4100, Storybook 6006.

## D-014: Building software during the manual-validation phase (NEEDS-FOUNDER-REVIEW)
The business plan says the first 30 days run by hand with 3 practices and 50 families before any serious software is written. Phase 0 (the plan-check sprint) ends on 2026-12-07, and nothing in this build helps it. The build proceeds as instructed. Suggested order if time is short: Phases 1–3 support the manual phase (ops console, call simulator, warnings); Phases 5–6 can wait until an IRB is engaged.

## D-015: Rate limits keyed per session and per (IP, account)
The first version limited login to 10 per minute per IP and everything else to 300 per minute per IP. The end-to-end suite showed two production problems:
- A clinic's staff share one office IP, so a per-IP login limit lets colleagues lock each other out at 9am.
- Server-side rendering reaches the API from the web server's single IP, so a per-IP global limit makes every user share one budget.

**Chosen:**
- Login: 10 per minute per (IP, e-mail), which stops guessing against one account, plus 60 per minute per IP across all accounts, which stops spraying.
- Global: 300 per minute per session, or per IP for signed-out requests.
- `/api/system/*` is exempt; it returns no data and the web app caches it.

Lockout after 5 failed passwords (S8) still applies per account.

## D-016: Self-hosted fonts
`next/font/google` downloads the fonts at build time. That failed intermittently on the dev machine and would make CI depend on Google. The six Anek subsets (about 2 MB in total, each loaded only when a page uses its script) are committed under `packages/web-shared/fonts` with the OFL notice. A side benefit: no browser ever requests a font from a third party.

## D-017: TypeScript 6.0, not 7
TypeScript 7 (the native compiler) is the current release, but `typescript-eslint` 8.72 supports only versions below 6.1. Lint rules carry product guarantees (S3, S10), so lint wins. Move to 7 when `typescript-eslint` supports it.

## D-018: Run-out warnings only when refills are known to be zero
Part D claims (PDE) carry the fill number but usually not how many refills the prescription allows. Without that, a "runs out in 10 days" warning would fire for every monthly medicine, every month, and families would learn to ignore it.

**Chosen:**
- `late_refill` comes from claims alone. It fires when the supply ended at least 3 days ago and no newer fill exists.
- `run_out` fires only when the latest fill shows zero refills left, meaning the next fill needs the doctor. Zero comes from the EOB's CARIN `refillsAuthorized`, or later from the desk or the refill-status skill (Phase 3).
- A medicine more than 30 days past its supply with no refill is treated as stopped.

## D-019: What counts as a warning (NEEDS-FOUNDER-REVIEW)
These are product calls with no single right answer. Each is a named constant in `packages/medicines/src/engine.ts`:
- **Late refill:** a 3-day grace period.
- **Stopped medicine:** 30 days past the supply.
- **Old news:** a change that took effect more than 30 days ago is no longer warned about.
- **Premium or price rise:** must be at least $10 *and* at least 20%. A 3% rise on an expensive drug is not news.
- **Price comparisons:** use a 30-day cost estimated as unit cost × 30. The pricing file has no units-per-day, so this is right for once-a-day tablets and rough otherwise.
- **Access status:** red under 15 days, amber 15–60, green over 60. The spec says red is "under 14", but that leaves day 14 in no band, so day 14 counts as red.
- **Pharmacy closures:** one warning per patient, not one per medicine.

The founder should confirm the thresholds against the manual-phase calls: which warnings families acted on, and which they ignored.

## D-020: Blue Button callback bound by state, not the session cookie
CMS redirects back cross-site, so the browser does not send the `SameSite=Strict` session cookie. Relaxing the cookie to `Lax` would weaken CSRF protection everywhere.

Instead, connecting stores `{patientId, userId, PKCE verifier}` in Redis under the SHA-256 of a 256-bit state, for 10 minutes. The callback deletes it on first use and acts with that user's current grants, so RLS still decides whether the link may be written. A forged, expired or replayed state goes nowhere.

## D-021: Mock Blue Button data is a snapshot as of the connection date
The mock generates six months of EOBs ending on the day the link was made, keyed by a hash of the synthetic MBI. Re-syncing therefore returns the same EOB ids, and ingestion stays idempotent. With real data, sync uses today.

## D-022: Seed in its own package
The seed now pushes medicines through the mock Blue Button and runs the engine, so it depends on `@tomoni/medicines`, which depends on `@tomoni/db`. Keeping the seed inside `db` would make a package cycle, so it moved to `packages/seed`. The engine benchmark lives there too.

## D-023: Conversation LLM: Claude Opus 5.5, low effort, structured output, no fallback model
The LLM only fills typed slots (mood, medicines taken, wants help). Each step has its own Zod schema, enforced with structured output (`output_config.format`). Effort is `low`, because this is classification and the call is waiting. The model is `claude-opus-5-5`, configurable through `TOMONI_LLM_MODEL`.

A refusal, timeout, truncation or off-schema answer becomes "unclear": the script asks once more, then moves on. The safety matcher has already run on the raw words, so a fallback model would add cost without adding safety, and none is configured.

The prompt is a versioned file (`packages/voice/prompts/slot-filler.v1.md`), recorded on every call. An opt-in eval runs it against the live model (`pnpm --filter @tomoni/voice eval`). It has not been run yet, because this machine has no API credentials.

## D-024: The daily-call scheduler is opt-in per environment
With Twilio on, the scheduler dials real people every 5 minutes. It runs only with `TOMONI_CALL_SCHEDULER=on`, and Twilio itself refuses to start unless `TOMONI_REAL_DATA_ENABLED=true`. In dev and CI, calls happen through the simulator.

## D-025: Calls in Gujarati, Tamil, Punjabi and Bengali speak English for now (NEEDS-FOUNDER-REVIEW)
The call script is complete in English and Hindi. The other four locales fall back to English line by line. The safety matcher already covers all six languages, so a Gujarati speaker's emergency is still caught. What they hear is English, though, and that is not acceptable for real patients. Native speakers must write and review these scripts before any real call in those languages. Until then, the founder must decide whether to call those patients in Hindi or English, or not at all.

## D-026: Agent code in `packages/agent`; the safety matcher in `packages/core`
ARCHITECTURE put the policy engine and skill registry in `packages/core`, which has no I/O. Skills call adapters, and the runner needs the database, so they live together in `packages/agent`. `packages/core` keeps the parts that must never be wrong and need no I/O: the safety matcher and scope building. The registry's policy rules (who approves what) are still pure data, with their own tests.

## D-027: Second market: the India bridge (NEEDS-FOUNDER-REVIEW)
The full reasoning is in STRATEGY.md. In short, Indian families abroad pay for daily calls to parents in India. That gives revenue from month one, Indian-language voice data at scale, and a second recruitment pool for the same sponsors.

What it changes in the product:
- A household has a region.
- In India, medicines come from family entry with a prescription photo as evidence, not from Blue Button.
- There is no APCM and no Medicare. The plan-check and APCM features are US-only.
- The India research cohort waits for the DPDP Rules research exemption (13 May 2027), an Indian ethics committee, and counsel on India's clinical-trial rules.

Counsel must confirm two things before any India patient is called: cross-border processing under the DPDP Act, and the telecom rules for automated calls.
