# Tomoni: Master Build Prompt for Claude Code

> Kept in the repo so every session can re-read it. This is the source spec; deviations are recorded in `docs/DECISIONS.md`.

---

## 0. Your role and how to work

You are the founding engineering team for **Tomoni**: a staff-level full-stack engineer, a product designer, a healthcare-security engineer and a QA lead in one. You are building a real product that older patients, their families, their doctors and drug-development sponsors will depend on. Quality beats speed. Take the time each step needs.

**Working rules (follow all of them, every session):**

1. **Plan before code.** First write `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/SECURITY.md` and `docs/ROADMAP.md`. Then build in the phases in section 9, in order. Do not start a phase until the previous phase meets its Definition of Done.
2. **Vertical slices.** Each feature ships end to end: database → API → worker → UI → tests → seed data → docs. No half-built layers.
3. **Nothing fake that looks real.** Every external integration sits behind an interface with two implementations: a real adapter and a clearly labeled `Mock*` adapter that runs locally. The UI shows a visible "SANDBOX" badge whenever a mock is active. Never hard-code fake success.
4. **Verify everything you claim.** After each slice, run the type checker, linter, unit tests, integration tests and Playwright end-to-end tests. Start the app and drive it. Take screenshots of every new screen and review them against the design rules in section 7. Fix what you find before moving on.
5. **Keep a running log.** Keep `docs/PROGRESS.md` up to date with what was done, what was tested, what is mocked, known gaps and the next steps. Make a small git commit per slice with a clear message.
6. **Ask only when blocked.** If a decision is truly ambiguous and expensive to reverse, write the options in `docs/DECISIONS.md`, pick the safest default, mark it `NEEDS-FOUNDER-REVIEW`, and continue.
7. **No real patient data.** Use only synthetic data (generate it with Synthea or your own seed generator) and the public Medicare Blue Button 2.0 **sandbox**. The system must be built so real data can be switched on only after legal sign-off.

---

## 1. What Tomoni is

Tomoni is an AI care team between doctor visits, and a living research cohort for drug development.

**The care layer (funded by Medicare's APCM monthly care-management payment to practices):**

- **Grandpa only talks.** He gets a 2–3 minute daily phone call in his language (Hindi, Gujarati, Tamil, Punjabi, Bengali, English, and more later). No app.
- **The family only taps.** They use a mobile-first app showing every medicine, every warning and every fix for the whole household, and they approve fixes with one tap.
- **The doctor only signs.** The doctor desk shows pre-checked refill renewals, pre-filled prior authorizations, drafted care plans, nurse flags and a monthly APCM billing list. Each needs one click.

**The science layer (paid for by drug developers and CROs), built only from opted-in, consented patients:**

- **Trial Bridge** matches research-registry members to trial eligibility criteria, pre-screens them by voice, lets their own doctor introduce the trial, and supports retention.
- **Voice Lab** runs a daily 20-second standardized speech task, builds a research-use speech dataset, and labels it with Medicare claims outcomes (hospital stays). It is **never** used for clinical decisions until FDA clearance.
- **Gene-to-Pill** checks pharmacogenomic results against current drugs and raises gene-drug warnings to the doctor.

**Four user surfaces:**

1. **Voice line:** outbound and inbound calls, plus a WhatsApp/SMS fallback.
2. **Family app:** a responsive PWA, mobile first.
3. **Doctor desk:** a web app for physicians, nurses and front-desk staff.
4. **Sponsor portal:** a web app for pharma and CRO users, with de-identified, aggregate views only.

There is also an **internal ops console** for the India operations team that handles escalations and quality review.

---

## 2. Non-negotiable safety, legal and ethics rules (enforce in code, not only in docs)

1. **No medical advice from the AI. Ever.** If a symptom, medication-change request or emergency word appears in any channel, the AI stops the current task and opens a nurse flag. Emergency phrases (chest pain, can't breathe, fell, stroke signs, suicidal language) trigger an immediate escalation to the practice and the family, plus an instruction to call emergency services. These rules are hard-coded and multilingual, and unit tests cover each language.
2. **Approved skills only.** The AI agent can act only through a typed, versioned skill registry (for example `checkRefillStatus`, `draftRenewalForDoctor`, `requestPharmacyTransfer`, `comparePartDPlans`, `draftFormularyException`, `findStock`, `bookPickup`). The agent has no open web access, no shell and no free-form API calls.
3. **Confirm → do → verify** on every action. Anything that moves money or a prescription requires family approval. Anything clinical requires doctor approval. Every action records a verification result.
4. **Append-only, hash-chained audit log** for every read and write of protected health information (PHI), every agent action, every consent change and every data export. It is visible in the UI to the right roles.
5. **Two consents, never mixed.** Care consent (APCM) and research consent (IRB protocol version, HIPAA authorization, call-recording permission) are separate records. **Research features must be impossible to reach without an active research consent.** Enforce this in the database (row-level security) and the API, and test it. Withdrawing consent stops data flow immediately and records the withdrawal.
6. **Capacity and representatives:** a patient can have a legally authorized representative, and consent records which person gave it.
7. **No finder's fees.** The data model has no field for paying a doctor per referral, and sponsor billing is only per service unit at fair-market-value rates set by admins. Add a test that fails if a per-referral payout to clinicians is ever introduced.
8. **Voice biomarker outputs are research-only.** They never appear in the family app, the doctor desk or any patient-facing message. Enforce this with a type-level `ResearchOnly<T>` wrapper and a lint rule.
9. **The sponsor portal sees only de-identified, aggregate data,** with small-cell suppression (no counts under 11). Re-identification is impossible from the API. Add a test for this.
10. **AI disclosure on every call** ("This is Tomoni, an automated assistant from Dr. ___'s office"). Calls go only to consented numbers, respect quiet hours and log consent to record.
11. **Neutral plan ranking.** Medicare plan comparisons rank only by total yearly cost for the person's drugs and pharmacy, and show any commission next to each plan.

---

## 3. Tech stack (use this unless you document a better reason in DECISIONS.md)

- **Monorepo:** pnpm + Turborepo. TypeScript in strict mode everywhere except the ML service.
- **Web apps:** Next.js (App Router) + React + Tailwind + Radix primitives + a shared `@tomoni/ui` design-system package. TanStack Query for data fetching. Zod for every boundary.
- **API:** Node.js with Fastify (or NestJS) and a tRPC or OpenAPI contract, generated typed clients, and OpenAPI docs served at `/docs`.
- **Database:** PostgreSQL with row-level security, Prisma or Drizzle migrations, and pgcrypto for column encryption of PHI fields.
- **Jobs and scheduling:** Redis + BullMQ (or Temporal if you justify it) for daily call scheduling, the warning engine, file ingestion and retries.
- **Real-time:** WebSockets (or SSE) behind an event bus. Every surface updates live when anything changes: a flag appears on the doctor desk within seconds of a call, and the family card updates when a refill is confirmed.
- **Voice:** a telephony interface (Twilio adapter + mock), a speech-to-text interface, a text-to-speech interface and a conversation engine. The conversation engine uses the Anthropic Claude API, with system prompts stored as versioned files and evaluated by tests.
- **ML service:** Python (FastAPI) for speech-feature extraction (research pipeline), with a typed contract to the main API.
- **Auth:** OIDC-ready auth with role-based access control (patient, family member, representative, physician, nurse, front desk, ops agent, sponsor user, admin), multi-factor authentication for clinical and sponsor roles, and session timeouts.
- **Observability:** OpenTelemetry traces, structured logs with PHI redaction, and a metrics dashboard.
- **Infrastructure:** Docker Compose for one-command local start (`pnpm dev:all`), plus Terraform skeletons for a HIPAA-eligible cloud setup (not applied).
- **Quality:** ESLint, Prettier, Vitest, Playwright, axe accessibility checks, and GitHub Actions CI running everything on every push.

---

## 4. Domain model (design it fully in DATA_MODEL.md first)

Core entities include, at minimum:

`Practice`, `Clinician`, `Patient`, `Household`, `FamilyMember`, `Representative`, `CareConsent`, `ResearchConsent` (with protocol version, HIPAA authorization, recording permission and withdrawal), `Medication`, `Fill` (from Part D claims), `Claim` (Part A/B), `Pharmacy`, `Plan`, `FormularyEntry`, `Warning` (type, source, evidence, `daysUntilProblem`, status), `Action` (skill, inputs, approvals, verification), `Approval`, `NurseFlag`, `CarePlan` (draft and signed versions), `ApcmMonthRecord` (services delivered plus evidence), `Call` (schedule, transcript, language, outcome, recordingConsent), `SpeechSample` (research-only), `PgxResult`, `GeneDrugRule`, `Trial`, `EligibilityCriterion`, `TrialMatch`, `Referral`, `Sponsor`, `SponsorContract` (service units and rates), `AuditEvent`.

---

## 5. Features to build, by module

### 5.1 Data ingestion
- Blue Button 2.0 OAuth flow against the **sandbox**. Ingest the FHIR ExplanationOfBenefit resources into `Fill` and `Claim`.
- CMS Part D plan, formulary and pricing public files: a loader for the real public file formats, plus a small bundled sample.
- PBM formulary change lists: an admin upload with a CSV mapping UI.
- A synthetic data generator for 500 patients across 20 households and 3 practices, multilingual and with realistic medicine regimens.

### 5.2 Early-warning engine
- A change detector that compares plan, formulary and price versions.
- A matcher that checks every change against each person's fills.
- A scorer that outputs `daysUntilProblem` and Access Score status (green: no known problem within 60 days; amber: 15–60 days; red: under 14 days).
- Warning types: run-out, late refill, premium jump, formulary removal, tier change, negotiated-price change, pharmacy closure, shortage, gene-drug mismatch.
- Each warning carries its source and date, and links to the evidence.

### 5.3 Action agent
- A skill registry, a policy engine (who must approve what), an approval inbox, retries with backoff, and a verification step.
- A human handoff to the ops console when the agent is stuck.

### 5.4 Daily call system
- A scheduler that respects time zones and quiet hours.
- Multilingual call scripts: greeting, wellbeing, medicines taken, upcoming items, and an optional research speech task only when research consent is active.
- An escalation engine.
- WhatsApp/SMS fallback.
- Full transcripts and summaries.
- A "call simulator" in development: a browser page where you talk or type as the patient, to test calls end to end without a phone.

### 5.5 Family app
- A morning family card.
- Access Score per medicine.
- One-tap approvals.
- An activity log of everything Tomoni did.
- Call summaries.
- Streaks (call streak, no-gap streak, with a streak shield), a savings and time counter, a weekly digest, and invites for siblings and the doctor.
- Language switcher.
- Large-text mode.

### 5.6 Doctor desk
- A keyboard-first queue: renewals, prior authorizations, exceptions, care-plan drafts and nurse flags, sorted by urgency, with one-click sign and bulk actions.
- Patient timeline (calls, fills, warnings, actions).
- APCM monthly billing list with an evidence export.
- Practice report (enrolled patients, APCM revenue, inbox messages avoided, problems caught early).

### 5.7 Research and science
- Research-registry consent flow (eConsent with a versioned protocol and a plain-language summary in each language).
- **Trial Bridge:** a criteria editor for sponsors, a matcher restricted to registry members, a voice pre-screen script, a doctor-introduction card, a referral tracker and retention support.
- **Voice Lab pipeline:** capture the standardized speech task, extract features (ML service), and link to claims outcomes. Research-only storage, with exports de-identified.
- **Gene-to-Pill:** a PGx result upload, a rules table seeded with a small set of well-established CPIC drug-gene pairs (for example CYP2C19–clopidogrel), and warnings routed to the doctor only.

### 5.8 Sponsor portal
- Feasibility counts by criteria (de-identified, with small cells suppressed).
- Referral funnel (matched → pre-screened → introduced → consented → randomized → retained).
- Contract service-unit usage and invoices.
- No patient-level data.

### 5.9 Ops console
- Escalation queue, call quality review per language, agent-stuck handoffs and audit log search.

---

## 6. Real-time and performance targets

- A nurse flag reaches the doctor desk in under 5 seconds after the call event.
- Family-card updates are pushed live.
- API p95 is under 300 ms for reads.
- The warning engine reprocesses 10,000 patients in under 5 minutes on a laptop.
- Lighthouse scores of 90 or more for performance and accessibility on the family app.
- Everything is idempotent and safe to retry, and every job has dead-letter handling.

---

## 7. UI/UX standard (top-tier, not template-looking)

- Build a real design system in `@tomoni/ui`: tokens for color, type, spacing, radius and motion; light and dark themes; and documented components (use Storybook).
- **Family app:** warm and calm. Body text 18px or larger, tap targets 48px or larger, WCAG 2.2 AA contrast or better, plain language, one primary action per screen, status shown with both color and icon plus text (never color alone).
- **Doctor desk:** dense and fast. Keyboard shortcuts for everything, zero-scroll triage, and the evidence beside every request so the doctor never has to look anything up.
- **Sponsor portal:** clean data views, honest charts, and every number shows how it was calculated.
- **Internationalization from day one:** every string goes through i18n. Ship English and Hindi complete, plus scaffolding for Gujarati, Tamil, Punjabi and Bengali. Support right-to-left layout for future languages.
- Empty, loading, error and offline states are designed for every screen.
- After each screen, take a Playwright screenshot at mobile and desktop sizes, review it like a demanding design lead, and fix spacing, hierarchy and copy before moving on.

---

## 8. Security (document in SECURITY.md and implement)

- Encryption in transit and at rest, plus field-level encryption for PHI.
- Secrets only in environment variables (an example `.env` file, nothing real committed).
- Row-level security tested per role.
- Rate limiting, input validation on every endpoint, and CSRF and XSS protections.
- Dependency scanning.
- PHI-free logs, enforced with a redaction middleware and a test.
- Prompt-injection defenses for the agent: tool outputs are treated as data, skills have strict schemas, and a red-team test suite covers malicious pharmacy or caller text.
- Backup and restore scripts, tested.

---

## 9. Build phases and Definition of Done

**Phase 1 — Foundation:**
- Monorepo, CI, design system, auth and roles, the database with row-level security, the audit log and synthetic data.
- *Done when:* `pnpm dev:all` starts everything, CI is green, and role tests pass.

**Phase 2 — Medicines core:**
- Blue Button sandbox ingestion, plan and formulary loaders, the early-warning engine and the family card with Access Scores.
- *Done when:* seeded households show correct, sourced warnings, and the end-to-end tests pass.

**Phase 3 — Voice and agent:**
- Call scheduler, call simulator, multilingual scripts, escalations, the skill registry and approvals.
- *Done when:* a simulated call with a symptom creates a nurse flag on the doctor desk live in under 5 seconds, and the emergency-phrase tests pass in every shipped language.

**Phase 4 — Doctor desk and APCM:**
- The queue, one-click signing, care plans, the billing list with evidence, and the practice report.
- *Done when:* a full "one week in Tomoni" scenario runs end to end in Playwright.

**Phase 5 — Research core:**
- Research consent, the registry, Trial Bridge, the sponsor portal and de-identification.
- *Done when:* the consent-gating, small-cell suppression and no-finder's-fee tests pass, and the referral funnel works end to end.

**Phase 6 — Voice Lab and Gene-to-Pill:**
- The speech task, the ML feature service, outcome linking, PGx rules and gene-drug warnings.
- *Done when:* the `ResearchOnly` boundary is proven by tests, and a clopidogrel/CYP2C19 scenario raises a doctor-only warning.

**Phase 7 — Hardening:**
- Load tests against the performance targets, the security checklist, accessibility audit fixes, observability dashboards, a backup and restore drill, and the final docs.
- *Done when:* every target in sections 6–8 is measured and met, and `docs/PROGRESS.md` lists any remaining gaps honestly.

---

## 10. Final deliverables

- A working monorepo that starts with one command, with seeded synthetic data and logins for each role (listed in the README).
- `README.md`: what Tomoni is, how to run it, the architecture diagram (Mermaid), role logins, and what is mocked versus real.
- `docs/`: ARCHITECTURE, DATA_MODEL, SECURITY, DECISIONS, PROGRESS, RUNBOOK, and a `GO_LIVE_CHECKLIST.md` listing everything required before real patients. The checklist covers:
  - legal review (APCM structure, anti-kickback, HIPAA, TCPA, state recording laws, IRB);
  - business associate agreements (BAAs) with every vendor;
  - a SOC 2 readiness review;
  - Blue Button production access;
  - FDA strategy for Voice Lab;
  - clinical protocol sign-off by a US physician.
- A 5-minute demo script that walks through: Raj's daily call → nurse flag → doctor one-click → family card update → research consent → trial match → sponsor funnel.

Begin now with section 0, rule 1: write the planning documents, then start Phase 1.
