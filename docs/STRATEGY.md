# Strategy: how Tomoni becomes a billion-dollar company

*Founder memo, 2026-11-15. Numbers marked "assumption" are targets to test, not forecasts.*

## The bet

Older people take most medicines, yet drug trials barely include them. South Asians are almost absent. Tomoni is the one company that talks to these patients every day, in their language, with their family and their doctor in the loop.

That daily relationship builds an asset that compounds and can't be bought later: a consented, longitudinal cohort. Each member brings daily voice, drug fills, hospital outcomes and, where tested, genotype. Care revenue pays for building the cohort. Pharma pays to use it.

The company is worth a billion dollars if it becomes the **patient and evidence layer for older, multilingual populations**. That is the category Tempus (data licensing) and Paradigm (trial access through care) are valued in. A care company with a research side project doesn't get there.

## The arithmetic

| Stage | Cohort (care patients) | Revenue | Mix | How it is valued |
| --- | --- | --- | --- | --- |
| Seed (end 2027) | 1,000 US + 2,000 India | ~$1M run rate | Care and family plans, first paid referrals | Traction and team |
| Series A (2028) | 15,000 | ~$8M | First sponsor contracts, voice cohort with outcomes | Science proof |
| Growth (2030) | 150,000 | ~$70M | ~45% science | Data and services multiple |
| $1B (2031) | 250,000+ | ~$120M | Majority science, high margin | Comparable to life-science tools companies |

All rows are assumptions. The PRODUCT model gives the anchor: $30M of care revenue and about $16M of science revenue at 100,000 patients. The jump to $1B comes from the science share, not from care growth.

## Decisions

1. **Two markets, one product.**
   - **US:** practices are paid by Medicare (APCM) and build the outcome-labeled cohort. Blue Button supplies the claims.
   - **India bridge:** Indian families abroad pay for a daily call to their parents in India.
     - The US has about 5.41 million Indian Americans, 3.40 million of them born in India ([Census via Telangana Today](https://telanganatoday.com/indian-american-population-in-us-rises-to-5-41-million-in-2025-census-data)).
     - It earns money from month one, without waiting for Medicare.
     - It trains Indian-language voice models on far more speech than any competitor will have. That is the moat.
     - India's data-protection rules were notified on 13 November 2025, and their research exemption applies from 13 May 2027 ([Hogan Lovells](https://www.hoganlovells.com/en/publications/indias-digital-personal-data-protection-act-2023-brought-into-force-)). That is when the India research cohort can open, with consent from day one.
     - The FDA can accept foreign trial data that meets GCP ([21 CFR 312.120](https://www.law.cornell.edu/cfr/text/21/312.120)), and India's 2019 rules allow concurrent global trials ([CDSCO](https://cdsco.gov.in/opencms/resources/UploadCDSCOWeb/2022/new_DC_rules/NEW%20DRUGS%20ANDctrS%20RULE,%202019.pdf)). Indian-site recruitment is therefore sellable to the same sponsors.
2. **Sell speed, not leads.** Trial Bridge is sold as a *trial-ready passport*. Every research member's eligibility is pre-checked from claims, fills and voice, so a sponsor enrolls in days. A day of delay costs a sponsor about $500,000 (PRODUCT), so speed is what pharma pays for.
3. **Start voice recording early.** The voice cohort is worth nothing on day one and a great deal after three years. The research speech task (Phase 6) moves ahead of the "nice" care features. It runs only with IRB approval and research consent, and recording starts the week the IRB approves.
4. **Not now:**
   - **Three-generation records:** linking relatives weakens de-identification, involves children, and puts consent problems on relatives who never agreed. Revisit with an IRB and privacy counsel.
   - **Selling side-effect signals:** adverse-event reporting stays a duty under each sponsor agreement, not a product.
   - **Running trial sites:** the Science 37 lesson.
5. **Trust is the product.** Research is a separate opt-in. Data use is listed publicly, results are given back, and doctors are never paid per referral. These rules are enforced in code, not only in policy (rules 2.5 to 2.9). If families stop trusting Tomoni, both businesses end.

## Build order (changes ROADMAP)

| Next | Why it matters to the bet |
| --- | --- |
| Phase 4: desk queue, care plans, **APCM billing evidence** | Doctors adopt Tomoni when it gets them paid. That brings US cohort growth |
| **India bridge slice:** medicines without Blue Button (family-entered and photographed prescriptions), refill reminders, family subscription | Revenue now; Indian-language calls at scale |
| Phase 5: research consent, pseudonyms, **trial-ready passport**, sponsor portal with suppression | First pharma revenue |
| Phase 6: speech task, outcome labels, Gene-to-Pill | The compounding moat |
| Phase 7: hardening, go-live checklist | Real patients |

## What has to be true (kill criteria, checked every quarter)

| Signal | Bar | If missed |
| --- | --- | --- |
| Daily call answer rate | ≥ 60% after week 4 | Fix the call before anything else |
| Family plan retention at 3 months (India) | ≥ 70% | The bridge is not a business; keep it as a research channel only |
| Research opt-in among care patients | ≥ 50% | The cohort thesis is weak; lead with care plus Trial Bridge |
| First sponsor or CRO letter of intent | By June 2027 | Sell to CROs as a recruitment vendor before selling data |
| Indian-language voice signal against hospital outcomes | Publishable by end 2027 | Partner with Cordio or ki:elements instead of building models |

## What only the founder can do

These can't be built in this repo:
- Engage a central IRB.
- Bring on a US physician principal investigator and a former-CRO clinical operations lead.
- Retain US and Indian counsel (anti-kickback, HIPAA research rules, DPDP).
- Sign the first three practices and the first 50 India families.
- Get one sponsor to say what they would pay for a trial-ready passport in heart failure.

The software is ahead of all of these. The next bottleneck is people and permissions, not code.
