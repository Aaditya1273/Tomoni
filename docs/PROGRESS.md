# Progress

## Current state
- **Phase 1 (Foundation): done.** Definition of Done met on 2026-11-15:
  - `pnpm dev:all` starts Postgres, Redis, the API, the web app and the sponsor portal.
  - Role tests pass.
  - The CI steps run green locally: format, lint, typecheck, tests, Storybook build, e2e and the dependency audit. The secret scan (gitleaks) has not run; it needs GitHub.
- **Next: Phase 2 (Medicines core).**

## Test inventory (all passing)

| Suite | Count | What it proves |
| --- | --- | --- |
| `packages/db` | 34 | RLS for 9 roles × patient/consent/household/practice tables; write denials; audit chain (sealing, tamper detection, append-only even for the owner); field encryption (round-trip, nonce, column binding, rotation, no plaintext at rest); no finder's-fee columns |
| `apps/api` | 18 | Login (generic errors, lockout, audit), MFA enroll/verify with replay protection and session rotation, idle timeouts by role, logout, CSRF + Origin, rate limits (per account, per IP spray), PHI-free logs, OpenAPI |
| `packages/ui` | 26 | Every token pair meets WCAG contrast in both themes |
| `packages/i18n` | 16 | Complete locales match English keys; placeholders preserved; fallback for scaffold locales |
| `packages/core` | 8 | Scope building keeps role families apart; MFA and session policy per role |
| `packages/config` | 8 | Lint fences research code off care and sponsor surfaces; raw HTML banned |
| `apps/web` e2e | 36 | Each demo role signs in and lands on its surface, desktop and mobile; MFA enforced; wrong-app routing; sign-out; Hindi + dark + large text persist; desk "?" shortcuts; sponsor portal isolation; CSP; axe WCAG 2.2 AA on every screen |

## Log

| Date | Slice | What was done | Tested | Mocked |
| --- | --- | --- | --- | --- |
| 2026-11-15 | Planning | Architecture, data model, security, roadmap, decisions | n/a | n/a |
| 2026-11-15 | 1.1 Monorepo | pnpm + Turborepo, strict TS, ESLint safety rules, Prettier, Vitest | Lint-rule tests | — |
| 2026-11-15 | 1.2 Infra | Docker Compose (Postgres 18, Redis 8), separate DB roles, `.env` generator | dev:all smoke | — |
| 2026-11-15 | 1.3 Database | Schemas, RLS, audit chain, field encryption, outbox | 34 DB tests | — |
| 2026-11-15 | 1.4 Auth | Sessions, MFA, CSRF, rate limits, log redaction, OpenAPI | 18 API tests | — |
| 2026-11-15 | 1.5 UI | Design system + Storybook, i18n (en, hi; 4 scaffolds), web + sponsor shells, SANDBOX bar, CSP | Contrast, i18n, e2e + axe | All adapters |
| 2026-11-15 | 1.6 Seed | Deterministic 500-patient world, 8 demo logins | e2e per role | — |

## Found and fixed by the tests
- **Session hooks never applied.** They were registered as an encapsulated Fastify plugin. Caught by the API tests.
- **Pooled connection leaked a user id.** A login helper set a session-level setting on a pooled connection. Replaced by `auth.user_grants()`.
- **Per-IP rate limits would lock out clinics and throttle server-side rendering.** Now keyed per session and per account (D-015).
- **A submit before hydration could put the password in the URL.** Forms are now `method="post"`.
- **Redirect loop in the sponsor portal** for non-sponsor accounts.

## Known gaps
- **Hindi copy:** written carefully, but needs review by a native speaker before any family sees it. Gujarati, Tamil, Punjabi and Bengali are scaffolds (a few strings; the rest falls back to English).
- **Family bottom navigation:** deliberately absent until Phase 2 adds the pages it would link to.
- **No worker app yet:** the outbox relay and the audit sealer arrive with the first jobs in Phase 2. Until then audit rows stay unsealed (the chain is verifiable after sealing).
- **Production hardening:** key management (KMS), backup drill, load tests, Lighthouse and observability are all Phase 7.
- **CI:** the workflow is written but has not run on GitHub yet; there is no remote.
- **Open decisions:** D-007 to D-011 and D-014 need founder (and counsel) review.

## Next
Phase 2, slice 2.1: Blue Button sandbox OAuth and EOB → `fill`/`claim`, behind `MockBlueButton`.
