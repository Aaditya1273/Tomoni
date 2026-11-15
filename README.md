# Tomoni

**The living cohort for aging families.** Grandpa gets a daily phone call, his family gets one app, and his doctor gets a between-visit care program that Medicare pays for. With his separate consent, the same call builds a long-running research cohort of older, multilingual patients, and drug developers pay Tomoni to find trial patients, measure them by voice and match medicines to their genes.

> *"tomo ni"* means *"together"* in Japanese. Tomoni brings the patient, the family, the doctor and the science together around one shared picture of care.

**Medicare pays for the care that builds the cohort; pharma pays for the science.**

---

## Status

**Pre-build, validation phase (November 2026).** No production code yet. The care network is proven by hand first. The research registry opens once an ethics board (IRB) approves it. See [Roadmap](#roadmap).

Full plan: *Tomoni: The Complete Plan* (Claude doc), two tabs: **Life-science core** and **Care engine (full plan)**.

---

## The problem

Medicines are tested on the wrong people, and the people who take them get little help between visits.

**For science:**

- Only 36% of participants in FDA-registered trials were over 65, and 9% over 75 (The Limbic, citing FDA).
- South Asians were 1.1% of major heart-disease trial participants (excluding one Indian trial), and none were in heart-failure trials (Mount Sinai review).
- Over 80% of trials miss enrollment targets, and about 30% of patients drop out (Applied Clinical Trials).
- One day of delay is worth about $500,000 in lost sales plus about $40,000 in direct cost (Tufts CSDD).
- 79% of Americans would likely join a trial if their doctor found one and recommended it (Research!America). What's missing is someone who knows the patient daily and has their data.

**For care:**

- 43% of US adults skipped taking a medicine as prescribed because of cost (KFF, March 2026).
- Doctors complete about 40 prior authorizations a week, costing about 13 hours (AMA).
- Since January 2025, Medicare has paid primary-care practices a monthly fee for between-visit care (APCM), about $54 a month in 2026 for patients with two or more chronic conditions. Small practices can't staff it.

The FDA is pushing the same way. Its December 2025 final guidance asks sponsors to enroll representative populations by age and comorbidity, and to justify restrictive eligibility criteria.

---

## How it works

Tomoni has two layers on one network.

| Layer | What it does | Who pays |
| --- | --- | --- |
| **Care layer** | Daily call, family app, early-warning engine, action agent, doctor desk | Medicare's APCM payment, through the practice |
| **Science layer** | Turns consented care data into a research cohort that three engines sell | Biopharma companies and CROs |

| User | What they do | Where |
| --- | --- | --- |
| Grandpa | Answers a 2–3 minute daily call in his own language | Phone or WhatsApp |
| The family | Taps once to approve a fix; helps decide on research and trials | Family app |
| The doctor | Clicks once to sign a pre-filled request; introduces trials | Doctor desk (web) |

**Two consents, never mixed.** Joining the care program is one decision. Joining the research cohort is a separate opt-in, with its own IRB-approved consent and HIPAA authorization, and it can be withdrawn at any time. Care never depends on research.

### What the cohort holds (opt-in patients only)

| Data | Source | Why science values it |
| --- | --- | --- |
| Daily voice (plus a 20-second standard speech task) | The daily call, in the patient's language | Longitudinal speech for voice biomarkers |
| Symptoms, side effects | Call answers | Daily patient-reported outcomes |
| Every drug fill | Part D claims via Blue Button 2.0 | Exact exposure and adherence |
| Hospital stays, ER visits, diagnoses | Part A/B claims via Blue Button 2.0 | Outcome labels for the voice data |
| Care plan and decisions | Doctor desk | Physician-signed clinical context |
| Genotype for key drug-gene pairs | Pharmacogenomic test, when clinically indicated | Gene-drug-outcome links in an underrepresented ancestry |

### The three science engines

1. **Trial Bridge** matches eligibility criteria against registry members only, using claims, fills, age, language and location. It pre-screens likely matches with a few IRB-approved questions on the call. The patient's own doctor introduces the trial, the family joins a consent-preparation call, and the trial site runs formal consent. Once the patient is enrolled, the daily call becomes a trial companion: visit reminders, transport, side-effect capture and voice questionnaires.
   - *First areas:* heart failure, type 2 diabetes and cardiometabolic disease, COPD, early cognitive decline.
2. **Voice Lab** builds and validates voice biomarkers, labeled by real Medicare outcomes. It starts with research-use pre-screens, then exploratory trial endpoints, then later an FDA-cleared voice alert.
   - *Evidence:* Cordio's HearO predicted over 70% of heart-failure events about 25 days early in a blinded 563-patient study (November 2026).
   - *The gap:* no one has validated a voice biomarker in Indian languages. Tomoni can partner with Cordio or ki:elements, or build its own models where none exist.
3. **Gene-to-Pill** adds pharmacogenomics to the early-warning engine.
   - *Evidence:* in 44,396 British South Asians, 57% were intermediate or poor CYP2C19 metabolizers, so clopidogrel works less well for them. Poor metabolizers had about three times the odds of a repeat heart attack.
   - *How it works:* the doctor decides whether to test, and Medicare's MolDX covers clinically indicated tests. Results feed every future prescription check.

### The care engine (unchanged)

1. **Daily call:** a check-in in the patient's language. It also serves as the practice's 24/7 line. Symptoms always go to the practice, and Tomoni never gives medical advice.
2. **Family app:** a morning card, an Access Score per medicine (green, amber or red) and a full action log.
3. **Early-warning engine:** matches real fills against upcoming plan, formulary, price and gene-drug issues, and outputs **days until a problem** per medicine.
4. **Action agent:** approved skills only, confirm → do → verify, digital routes before calls.
5. **Doctor desk:** pre-checked refills, pre-filled prior authorizations, care-plan drafts, nurse flags, the APCM billing list and trial introductions.

---

## Automation and safety

| Level | Examples | Who acts |
| --- | --- | --- |
| Zero taps | Daily calls, run-out predictions, plan checks, billing logs | Tomoni alone |
| One tap | Switch pharmacy, pay a cash price, start a plan switch | Family approves |
| One click | Refills, prior authorizations, care-plan updates, gene tests, trial introductions | Doctor decides |
| Never automated | Diagnosis, dosing, drug choice, symptoms, formal trial consent | Nurse, doctor or trial site only |

- **Approved skills only** (see *When OpenClaw Meets Hospital*, arXiv 2603.11721).
- **Confirm → do → verify** on every action (see *PatientAgentBench*, arXiv 2607.25485).
- **Symptoms always go to a human**, even in the middle of an admin task.
- **AI disclosed on every call**, and explicit recording consent before any research recording.
- **Voice biomarkers are research use only** until FDA-cleared, and are never shown to anyone as a diagnosis.
- **Append-only audit log**, plus validated audit trails for anything used as trial data.

---

## Ethics and trust rules

Trust is the moat. Families who feel their parents' data is being sold would end both businesses.

- Research is a separate, withdrawable opt-in. Where capacity is in doubt, consent comes through a legally authorized representative.
- Data is de-identified by default, and a public list shows who used it and why.
- **Doctors are never paid per referral.** Labs never pay Tomoni per test.
- Sponsors pay fair-market-value service fees under written agreements, never tied to a trial's outcome.
- Side effects heard on calls are routed under each sponsor's safety-reporting agreement.
- A plain-language genetic notice: US law protects health insurance and jobs, but not life or long-term-care insurance.
- Participants get study results back in plain language.

---

## Who it serves

- **Cohort and care wedge:** older Medicare patients with chronic disease and their adult children (35–60), plus their small independent primary-care practices. Multilingual South Asian families come first.
- **Science customers:** biopharma sponsors and CROs that need older, multimorbid, diverse patients, plus pharma research teams licensing de-identified data.
- **Whole family (Family Plus):** kids, young adults and adults on the same app.

---

## Business model

| Revenue line | Who pays | Price (to test) |
| --- | --- | --- |
| Care program | Practice, from APCM | Flat $25 per enrolled patient per month |
| Family Plus | Family | About $9.99 a month per household |
| Trial Bridge: recruitment | Sponsors and CROs | Fair-market-value fee per pre-screened referral and per randomized participant |
| Trial Bridge: retention | Sponsors and CROs | Fee per participant-month |
| Voice Lab studies | Sponsors | Per-study contracts |
| Cohort data licensing | Pharma research | Annual licenses, after 10,000+ consented members |
| Voice alert (later) | Practices and payers | Once FDA-cleared, year 3+ |

**Per care patient (APCM code G0557, $53.78/month):** Medicare pays $43.02, the patient co-pay is $10.76, Tomoni earns $25 and the practice keeps $28.78. Base-case cost is $11.75 a month (53% gross margin).

**Illustrative science revenue at 100,000 care patients** (assumptions, not forecasts):

| Assumption | Value | Annual revenue |
| --- | --- | --- |
| Opt in to the research registry | 60% = 60,000 | — |
| Randomized into a trial each year | 3% = 1,800 | — |
| Recruitment fee per randomized participant | $2,500 | $4.5M |
| Retention and voice-outcome fee | $150 × 9 months | $2.4M |
| Voice Lab sponsor studies | 6 × $750,000 | $4.5M |
| Data licenses | 5 × $1M | $5.0M |
| **Total science** | | **≈ $16.4M** |

Care revenue at the same scale is $30M a year (about $15.9M gross profit), so science would be about 35% of revenue. Real prices come only from the first sponsor contracts.

A **flat care fee, never a percentage of billing**, keeps the anti-kickback structure clean. US counsel must approve every contract type before launch.

---

## Competitors

| Player | Strength | Gap Tomoni fills |
| --- | --- | --- |
| Paradigm Health (~$359M raised) | Trials embedded in routine care; oncology for 15 of the top 20 pharma companies | Works through health systems; no daily patient, family or small-practice relationship |
| Tempus (~$316M data revenue, 2025) | Multimodal data licensing to 70+ pharma customers | Mostly oncology and genomics; no voice or daily patient-reported data |
| Cordio, ki:elements | Validated voice biomarkers | One disease, European languages, no ongoing care relationship |
| Cadence, Epic, senior call bots | Care workflows | No science layer; top-down, or no doctor side |
| Science 37 (now ~$38M) | Decentralized trial sites | The lesson: don't run trial sites; own the patient relationship and partner with sites |

---

## Planned architecture

```
            Grandpa (phone)    Family (app)    Doctor (web desk)
                   \                |                /
                    +---------- Tomoni engine ------+
                    |  Care: early-warning engine,   |
                    |        action agent, audit log |
                    |  Science (opt-in cohort only): |
                    |    Trial Bridge · Voice Lab ·  |
                    |    Gene-to-Pill                |
                    +--------------------------------+
                      ^                          |
   Data in: Blue Button, CMS files,      Acts on: pharmacies, insurers,
   PBM lists, Patient Access APIs,       practices, trial sites, CROs,
   daily calls, PGx lab results          certified labs
```

**Compliance targets:** HIPAA (including the research authorization), IRB-approved protocols, FDA guidance for remote digital health data, 21 CFR Part 11-style audit trails for trial data, SOC 2, and TCPA-compliant calling. Personal data is never sold.

### Planned repository layout

```
tomoni/
├── engine/        # change detector, matcher, scorer (incl. gene-drug pairs)
├── agent/         # approved skills, confirm-do-verify runtime, audit log
├── voice/         # daily call flows, languages, escalation rules, speech task
├── research/
│   ├── cohort/    # consent registry, de-identification, data-use log
│   ├── trials/    # Trial Bridge matching and retention
│   └── voicelab/  # biomarker models and outcome labeling
├── apps/
│   ├── family/    # family app (mobile + WhatsApp)
│   └── desk/      # doctor desk (web)
├── data/          # Blue Button, CMS file, PBM list and lab-result ingestion
├── compliance/    # consents, BAAs, IRB protocols, billing logs, safety reports
└── docs/
```

---

## Roadmap

| Phase | Dates | Goal | Gate to pass |
| --- | --- | --- | --- |
| 0. Plan-check sprint | Nov 15 – Dec 7, 2026 | Free 2027 drug-plan checks for 50 families, by hand | Families act before Dec 7 |
| 1. Care proof + research readiness | Dec 2026 – Jan 2027 | 3 practices + 50 families, run manually; ask families about research interest; engage a central IRB and draft protocols | Doctor time under 1 minute per request; IRB engaged |
| 2. Voice cohort opens | Feb – Jun 2027 | IRB-approved observational cohort of the first 500 patients; one Trial Bridge pilot; first gene-drug flags | Cohort consenting; pilot signed |
| 3. First science revenue + seed | Jul – Dec 2027 | First paid referrals and randomizations; first Indian-language voice-outcome analysis submitted for publication | **Raise seed** on care traction plus science proof |
| 4. Regulated products | 2028 | FDA pre-submission for a voice alert; data licensing once the registry passes 10,000 members | — |

### Seed milestones (to set with investors)

- 1,000+ enrolled care patients, with at least 50% opting in to the research registry
- 500+ voice-cohort patients with 3+ months of daily recordings
- One signed sponsor or CRO contract and the first randomized participants
- Referral-to-randomization conversion and 90-day trial retention, measured
- A first voice-outcome analysis in at least two Indian languages

---

## Key risks

| Risk | Mitigation |
| --- | --- |
| Families distrust research use | Separate opt-in, consent in their language, public data-use list, results shared back |
| Medicare billing and anti-kickback scrutiny | Bill only what is delivered; flat fees; nothing to doctors per referral; US counsel signs every contract type |
| Voice models fail in new languages | Make Indian-language validation the first research project; partner where others lead |
| Slow pharma sales | Start with one or two sponsors in one area; sell to CROs; care revenue stays the base |
| Claims gaps (no Medicare Advantage medical claims in Blue Button) | Use Original Medicare patients for outcome labels; add Patient Access APIs and practice records |
| Adverse-event duties | Safety procedures in place before the first sponsor contract |
| Paradigm or Tempus move down | Win the multilingual, home-based segment first; consider partnering as their source of diverse patients |
| Diversity policy shifts | Lead with age and comorbidity, which the December 2025 final guidance covers |

---

## Team needed

1. A US healthcare and research-regulatory lawyer (APCM structure, anti-kickback, HIPAA research rules, FDA device pathway)
2. A US primary-care physician as co-founder or advisor, ideally also the **principal investigator** for research protocols
3. A **clinical operations lead from a CRO** or trial-site network
4. A **speech-AI and biostatistics scientist**
5. A licensed Medicare agency partner, a US pharmacist or pharmacogenomics advisor, and a central IRB
6. An India operations team: multilingual callers and backup to the AI

---

## Principles

- Never sell personal data.
- Never give medical advice.
- Never take money that changes a recommendation, and never pay a doctor per referral.
- Care never depends on research.
- Show every action in the log, and show families where their data went.

---

*Every figure in this README comes from the sources cited in "Tomoni: The Complete Plan" (as of November 15, 2026). Business-model numbers are arithmetic on stated assumptions, not forecasts.*
