# Five-minute demo

Raj Patel, 73, lives in New Jersey and speaks Gujarati. His daughter Asha follows his care from the family app. Every step below runs on synthetic data. The **Sandbox** bar names every mocked integration on screen, so say that up front.

**Before you start:** `pnpm dev:all`, then open four browser windows (or profiles), signed in with the password `tomoni-demo-2026`:
1. `nurse.priya@demo.tomoni.test` on the care desk,
2. `dr.rao@demo.tomoni.test` on the care desk,
3. `asha@demo.tomoni.test` on the family app,
4. `raj@demo.tomoni.test` on the family app.

Staff enrol MFA on first sign-in, so do that beforehand. Keep `sponsor@demo.tomoni.test` ready on http://localhost:3100.

## 0:00 – Raj's daily call (60 s)
*Nurse window → **Call simulator**.* Pick **Raj Patel (gu)** and click **Start call**.
- Point at the first line: Tomoni says it is automated, who it calls for, whether it records, and that it gives no medical advice.
- Reply as Raj: **"I'm fine"**, then **"yes"** (medicines taken), then **"yes please"** to the first upcoming item.
- Say: the AI only fills typed answers. Every word Raj hears comes from a reviewed script.

## 1:00 – A nurse flag (45 s)
Start a second call and reply **"Mujhe chakkar aa rahe hain"** (I feel dizzy).
- The call stops asking admin questions and tells Raj a nurse will call back today.
- *Switch to the doctor's window:* the flag is already in the queue, live, with Raj's words beside it. The budget is 5 seconds; we measure 92 ms.
- Try **"chest pain"** in any of the six languages: the call ends with the 911 script, and the family is alerted.

## 1:45 – The doctor, one key (45 s)
*Doctor window → **Queue**.* Press **j** and **k** to move and **s** to sign Raj's renewal request. The evidence pane shows the fills and refill count, so nothing needs looking up.
- Open Raj's patient page from **APCM billing**. Show the signed care plan, and that the month is billable with its evidence.

## 2:30 – The family card (45 s)
*Asha's window.* Reload. Raj's card shows the action as done, in plain words, with where each fact came from: a claim or a data file version.
- Open **Everything Tomoni did**: calls, actions and the nurse flag, without Raj's own words.

## 3:15 – Research consent (40 s)
*Raj's window → **Research studies**.* Say: this is a second consent, separate from care, and each use is its own opt-in.
- Check **Find medical studies that may fit**, type **Raj Patel** to sign, and click **I agree**.
- Say: withdrawal is one click, and research data disappears on the next query, enforced in the database.

## 3:55 – A trial match (35 s)
*Doctor window → desk.* Within seconds the card **Raj Patel may fit HEART-SA** appears. Matching uses closed criteria only.
- Click **Introduced at visit**. Say: it's the patient's own doctor who introduces the study, and nobody is paid per enrolment.

## 4:30 – The sponsor funnel (30 s)
*Sponsor portal (:3100).* Show HEART-SA's funnel: counts rounded to 5, anything under 11 hidden, and no names anywhere.
- In **Feasibility**, check **heart failure** and click **Count**: an aggregate only, with how it was calculated.
- Close: the sponsor pays for work done (introductions, consent-prep calls), never for a randomized patient.

## If something goes wrong
- No flag on the desk: check the worker is running (RUNBOOK "Incidents").
- No match card: the match job runs on consent; reload after a few seconds.
- Reset everything: `pnpm db:reset && pnpm db:seed`.
