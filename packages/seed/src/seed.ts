import { sql } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { hashFor, ownerDb, realDataEnabled, schema, withScope } from '@tomoni/db';
import { systemScope } from '@tomoni/core';
import {
  blueButtonFromEnv,
  ingestBundles,
  KOKILA_MBI,
  loadSamples,
  MockBlueButton,
  mockBeneficiaryId,
  RAJ_MBI,
  runEngine,
  today,
} from '@tomoni/medicines';
import { matchTrials } from '@tomoni/trials';
import { POOLS, type Lang } from './names';

/**
 * Deterministic synthetic world (DATA_MODEL "Synthetic seed", DECISIONS D-012).
 * 3 practices, 500 patients: 20 scripted households (named families with logins) + single-patient
 * households for the rest. Same output on every machine: seeded PRNG, fixed reference date.
 * Medicines arrive the way they would in production: through Blue Button (the mock adapter),
 * then the warning engine runs over everyone.
 */
export const DEMO_PASSWORD = process.env.TOMONI_DEMO_PASSWORD ?? 'tomoni-demo-2026';
export const SPONSOR_DEMO_ID = '019a0000-0000-7000-8000-00000000a001';

export const DEMO_LOGINS = [
  {
    email: 'asha@demo.tomoni.test',
    name: 'Asha Patel',
    role: 'family_member',
    note: "Raj's daughter (Patel household)",
  },
  { email: 'raj@demo.tomoni.test', name: 'Raj Patel', role: 'patient', note: 'Raj himself' },
  {
    email: 'priya@demo.tomoni.test',
    name: 'Priya Mehta',
    role: 'family_member',
    note: "Sunita's daughter in New Jersey (India bridge)",
  },
  { email: 'dr.rao@demo.tomoni.test', name: 'Dr. Anil Rao', role: 'physician', note: 'Rao Family Medicine' },
  {
    email: 'nurse.priya@demo.tomoni.test',
    name: 'Priya Nair, RN',
    role: 'nurse',
    note: 'Rao Family Medicine',
  },
  {
    email: 'frontdesk@demo.tomoni.test',
    name: 'Maria Lopez',
    role: 'front_desk',
    note: 'Rao Family Medicine',
  },
  {
    email: 'ops.kiran@demo.tomoni.test',
    name: 'Kiran Rao',
    role: 'ops_agent',
    note: 'Sunrise Internal Medicine (offshore ops on)',
  },
  {
    email: 'research@demo.tomoni.test',
    name: 'Leah Okafor',
    role: 'research_coordinator',
    note: 'Trial Bridge funnel: matched names only, every read audited',
  },
  { email: 'admin@demo.tomoni.test', name: 'Tomoni Admin', role: 'admin', note: 'Everything, audited' },
  {
    email: 'sponsor@demo.tomoni.test',
    name: 'Dana Whitfield',
    role: 'sponsor_user',
    note: 'Demo sponsor (aggregates only)',
  },
] as const;

function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seed(log: (m: string) => void = () => {}, opts: { force?: boolean } = {}) {
  if (realDataEnabled() || process.env.NODE_ENV === 'production')
    throw new Error('seed refused: real data enabled');
  const db = ownerDb();
  const existing = await db.select({ id: schema.practice.id }).from(schema.practice).limit(1);
  if (existing.length && !opts.force) {
    log('already seeded (use db:reset to start over)');
    return;
  }
  const rnd = prng(20261115);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const pw = await hash(DEMO_PASSWORD, { memoryCost: 65536, timeCost: 3, parallelism: 1 });

  const practices = await db
    .insert(schema.practice)
    .values([
      {
        name: 'Rao Family Medicine',
        tz: 'America/New_York',
        npi: '1000000001',
        phone: '732-555-0100',
        address: 'Edison, NJ',
        apcmEnrolledAt: '2026-01-02',
      },
      {
        name: 'Sunrise Internal Medicine',
        tz: 'America/New_York',
        npi: '1000000002',
        phone: '201-555-0200',
        address: 'Jersey City, NJ',
        apcmEnrolledAt: '2026-03-01',
        offshoreOpsAccess: true,
      },
      {
        name: 'Lakeview Geriatrics',
        tz: 'America/Chicago',
        npi: '1000000003',
        phone: '312-555-0300',
        address: 'Chicago, IL',
        apcmEnrolledAt: '2026-05-15',
      },
    ])
    .returning();
  const [rao, sunrise, lakeview] = practices as [
    (typeof practices)[number],
    (typeof practices)[number],
    (typeof practices)[number],
  ];
  const stateOf = (pid: string) => (pid === lakeview.id ? 'IL' : 'NJ');
  const tzOf = (pid: string) => (pid === lakeview.id ? 'America/Chicago' : 'America/New_York');

  let phoneN = 1000;
  const phone = () => `201-555-${String(phoneN++).padStart(4, '0')}`;
  // Synthetic MBIs start with 0, which no real MBI does (see medicines/bluebutton/scenarios.ts).
  let mbiN = 0;
  const nextMbi = () => `0TM${String(mbiN++).padStart(8, '0')}`;
  const patientRow = (
    practiceId: string,
    householdId: string,
    name: string,
    locale: Lang,
    birthYear: number,
    mbi = nextMbi(),
  ) => {
    const ph = phone();
    const month = 1 + Math.floor(rnd() * 12);
    const day = 1 + Math.floor(rnd() * 28);
    return {
      practiceId,
      householdId,
      mbi,
      mbiHash: hashFor.mbi(mbi),
      name,
      dob: `${birthYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      birthYear,
      phone: ph,
      phoneHash: hashFor.phone(ph),
      state: stateOf(practiceId),
      locale,
      tz: tzOf(practiceId),
      medicareType: (rnd() < 0.7 ? 'original' : 'advantage') as 'original' | 'advantage',
    };
  };

  // ── Scripted households (the demo story) ──────────────────────────────────
  const [patel] = await db
    .insert(schema.household)
    .values({ displayName: 'Patel', primaryLocale: 'gu' })
    .returning();
  const [raj] = await db
    .insert(schema.patient)
    .values({
      ...patientRow(rao.id, patel!.id, 'Raj Patel', 'gu', 1953, RAJ_MBI),
      preferredName: 'Raj-bhai',
      medicareType: 'original',
    })
    .returning();
  const [kokila] = await db
    .insert(schema.patient)
    .values(patientRow(rao.id, patel!.id, 'Kokila Patel', 'gu', 1956, KOKILA_MBI))
    .returning();
  const [asha] = await db
    .insert(schema.familyMember)
    .values({
      householdId: patel!.id,
      displayName: 'Asha Patel',
      relationship: 'daughter',
      phone: '415-555-0144',
      phoneHash: hashFor.phone('415-555-0144'),
    })
    .returning();
  await db
    .insert(schema.familyMember)
    .values({ householdId: patel!.id, displayName: 'Nikhil Patel', relationship: 'son' });

  const scriptedLangs: Lang[] = [
    'hi',
    'ta',
    'pa',
    'bn',
    'gu',
    'en',
    'hi',
    'ta',
    'gu',
    'pa',
    'bn',
    'hi',
    'en',
    'gu',
    'ta',
    'hi',
    'pa',
    'bn',
    'gu',
  ];
  const pList = [rao, sunrise, lakeview];
  for (const [i, lang] of scriptedLangs.entries()) {
    const fam = pick(POOLS[lang].family);
    const [h] = await db
      .insert(schema.household)
      .values({ displayName: fam, primaryLocale: lang })
      .returning();
    const practice = pList[i % 3]!;
    const n = rnd() < 0.4 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      await db
        .insert(schema.patient)
        .values(
          patientRow(
            practice.id,
            h!.id,
            `${pick(POOLS[lang].given)} ${fam}`,
            lang,
            1938 + Math.floor(rnd() * 22),
          ),
        );
    }
    await db.insert(schema.familyMember).values({
      householdId: h!.id,
      displayName: `${pick(POOLS[lang].given)} ${fam}`,
      relationship: pick(['daughter', 'son', 'daughter-in-law', 'niece']),
    });
  }

  // ── The rest: single-patient households up to 500 patients ────────────────
  const [{ count }] = (
    await db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM care.patient`)
  ).rows as [{ count: number }];
  const langs: Lang[] = ['gu', 'hi', 'hi', 'ta', 'pa', 'bn', 'en', 'en'];
  const rows = [];
  for (let i = count; i < 500; i++) {
    const lang = pick(langs);
    const fam = pick(POOLS[lang].family);
    const [h] = await db
      .insert(schema.household)
      .values({ displayName: fam, primaryLocale: lang })
      .returning();
    rows.push(
      patientRow(
        pick(pList).id,
        h!.id,
        `${pick(POOLS[lang].given)} ${fam}`,
        lang,
        1935 + Math.floor(rnd() * 26),
      ),
    );
  }
  for (let i = 0; i < rows.length; i += 100) await db.insert(schema.patient).values(rows.slice(i, i + 100));

  // ── Consents: ~80% of patients enrolled in APCM; contact consent for the same ─
  const all = await db
    .select({
      id: schema.patient.id,
      practiceId: schema.patient.practiceId,
      phoneHash: schema.patient.phoneHash,
    })
    .from(schema.patient);
  const given = new Date('2026-10-01T15:00:00Z');
  const enrolled = all.filter((p) => p.id === raj!.id || rnd() < 0.8);
  for (let i = 0; i < enrolled.length; i += 200) {
    const batch = enrolled.slice(i, i + 200);
    await db.insert(schema.careConsent).values(
      batch.map((p) => ({
        patientId: p.id,
        practiceId: p.practiceId,
        givenByKind: 'patient' as const,
        method: 'verbal_recorded' as const,
        copayDisclosed: true,
        givenAt: given,
      })),
    );
    await db.insert(schema.contactConsent).values(
      batch.map((p) => ({
        patientId: p.id,
        channel: 'voice' as const,
        phoneHash: p.phoneHash!,
        recordingAllowed: rnd() < 0.7,
        givenByKind: 'patient' as const,
        givenAt: given,
      })),
    );
  }

  // ── India bridge (D-027): a mother in Ahmedabad, her daughter in New Jersey ──
  const [indiaTeam] = await db
    .insert(schema.practice)
    .values({
      name: 'Tomoni India Care Team',
      tz: 'Asia/Kolkata',
      phone: '+91-79-5555-0100',
      address: 'Ahmedabad, GJ',
      offshoreOpsAccess: true,
    })
    .returning();
  const [mehta] = await db
    .insert(schema.household)
    .values({ displayName: 'Mehta', primaryLocale: 'gu', region: 'IN' })
    .returning();
  const [sunita] = await db
    .insert(schema.patient)
    .values({
      practiceId: indiaTeam!.id,
      householdId: mehta!.id,
      name: 'Sunita Mehta',
      preferredName: 'Sunita-ben',
      dob: '1952-08-14',
      birthYear: 1952,
      phone: '+91-98250-55501',
      phoneHash: hashFor.phone('+91-98250-55501'),
      state: 'GJ',
      locale: 'gu',
      tz: 'Asia/Kolkata',
      medicareType: 'none',
    })
    .returning();
  const [priyaMember] = await db
    .insert(schema.familyMember)
    .values({ householdId: mehta!.id, displayName: 'Priya Mehta', relationship: 'daughter' })
    .returning();
  await db.insert(schema.contactConsent).values({
    patientId: sunita!.id,
    channel: 'voice',
    phoneHash: hashFor.phone('+91-98250-55501'),
    recordingAllowed: false,
    givenByKind: 'patient',
    givenAt: given,
  });
  // Entered by Priya from the pharmacy bills, the way the India bridge works (no Blue Button).
  const ago = (n: number) =>
    new Date(Date.parse(`${today()}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  for (const [name, filled, qty, perDay, refills] of [
    ['Telmisartan 40 mg', 21, 30, 1, 0],
    ['Metformin 500 mg', 10, 60, 2, null],
    ['Atorvastatin 10 mg', 40, 30, 1, 3],
  ] as const) {
    const [m] = await db
      .insert(schema.medication)
      .values({ patientId: sunita!.id, displayName: name, source: 'family' })
      .returning();
    await db.insert(schema.fill).values({
      patientId: sunita!.id,
      medicationId: m!.id,
      fillDate: ago(filled),
      daysSupply: Math.ceil(qty / perDay),
      quantity: String(qty),
      refillsRemaining: refills,
      source: 'manual',
      sourceRef: `family:seed-${name.split(' ')[0]!.toLowerCase()}`,
    });
  }

  // ── Staff and logins ───────────────────────────────────────────────────────
  for (const d of DEMO_LOGINS) {
    const [u] = await db
      .insert(schema.userAccount)
      .values({ email: d.email, displayName: d.name, passwordHash: pw })
      .returning();
    const scope =
      d.role === 'family_member'
        ? { householdId: d.email.startsWith('priya') ? mehta!.id : patel!.id }
        : d.role === 'patient'
          ? { patientId: raj!.id }
          : d.role === 'ops_agent'
            ? { practiceId: sunrise.id }
            : d.role === 'sponsor_user'
              ? { sponsorId: SPONSOR_DEMO_ID }
              : d.role === 'admin' || d.role === 'research_coordinator'
                ? {}
                : { practiceId: rao.id };
    await db.insert(schema.roleGrant).values({ userId: u!.id, role: d.role, ...scope });
    if (d.role === 'physician' || d.role === 'nurse' || d.role === 'front_desk') {
      await db.insert(schema.clinician).values({
        practiceId: rao.id,
        userId: u!.id,
        kind: d.role,
        displayName: d.name,
        ...(d.role === 'physician' ? { npi: '1999999991' } : {}),
      });
    }
    if (d.role === 'family_member')
      await db
        .update(schema.familyMember)
        .set({ userId: u!.id })
        .where(sql`id = ${d.email.startsWith('priya') ? priyaMember!.id : asha!.id}`);
  }
  for (const [p, name] of [
    [sunrise, 'Dr. Meena Iyer'],
    [lakeview, 'Dr. Thomas Grant'],
  ] as const) {
    await db.insert(schema.clinician).values({ practiceId: p.id, kind: 'physician', displayName: name });
  }

  // ── Coverage: public files, each patient's Part D plan (same plan both years) ─
  await loadSamples(db);
  const people = await db
    .select({
      id: schema.patient.id,
      mbi: schema.patient.mbi,
      state: schema.patient.state,
      medicareType: schema.patient.medicareType,
    })
    .from(schema.patient)
    .where(sql`mbi_hash IS NOT NULL`); // Medicare patients only: Part D plans and Blue Button are US-only
  const planOf = (p: (typeof people)[number]) =>
    p.id === raj!.id
      ? 'S9901-001-0'
      : p.id === kokila!.id
        ? 'S9902-001-0'
        : p.medicareType === 'advantage'
          ? 'H9903-002-0'
          : p.state === 'IL'
            ? 'S9904-001-0'
            : pick(['S9901-001-0', 'S9902-001-0']);
  const plans = people.flatMap((p) => {
    const [contractId, planId, segmentId] = planOf(p).split('-') as [string, string, string];
    return [2026, 2027].map((year) => ({ patientId: p.id, year, contractId, planId, segmentId }));
  });
  for (let i = 0; i < plans.length; i += 500)
    await db.insert(schema.patientPlan).values(plans.slice(i, i + 500));

  // ── Medicines through Blue Button (mock), then the warning engine ──────────
  const bb = blueButtonFromEnv({ ...process.env, TOMONI_ADAPTER_BLUEBUTTON: 'mock' });
  if (!(bb instanceof MockBlueButton)) throw new Error('seed uses the mock Blue Button only');
  const asOf = today();
  let fills = 0;
  for (const p of people) {
    const tokens = await bb.exchange({ mockBeneficiaryId: mockBeneficiaryId(p.mbi!) });
    await db.insert(schema.bluebuttonLink).values({
      patientId: p.id,
      mode: 'mock',
      fhirPatientId: tokens.fhirPatientId,
      scope: tokens.scope,
      lastSyncedAt: new Date(),
    });
    fills += (await ingestBundles(db, p.id, await bb.fetchBundles(tokens, asOf), 'mock')).fills;
  }
  const run = await withScope('worker', systemScope('seed'), (w) => runEngine(w, { today: asOf }));

  // ── Research registry (Phase 5): an approved protocol, a synthetic sponsor study, opt-ins ──
  const SUMMARY = {
    en: 'Tomoni Registry is a research study. If you join, researchers may use your Tomoni records, without your name, to find medical studies that fit people like you and to improve care for older adults. Joining is your choice. It does not change your care. You can leave at any time, and from then on your data is not used.',
    hi: 'Tomoni रजिस्ट्री एक शोध अध्ययन है। अगर आप जुड़ते हैं, तो शोधकर्ता आपके नाम के बिना आपके Tomoni रिकॉर्ड का उपयोग कर सकते हैं, ताकि आप जैसे लोगों के लिए सही मेडिकल अध्ययन मिलें और बुज़ुर्गों की देखभाल बेहतर हो। जुड़ना आपकी मर्ज़ी है। इससे आपकी देखभाल नहीं बदलती। आप कभी भी छोड़ सकते हैं, और उसके बाद आपका डेटा उपयोग नहीं होगा।',
  };
  const [admin] = (
    await db.execute<{ id: string }>(
      sql`SELECT id FROM auth.user_account WHERE email = 'admin@demo.tomoni.test'`,
    )
  ).rows;
  const [protocol] = (
    await db.execute<{
      id: string;
    }>(sql`INSERT INTO research.protocol (code, version, title, irb_name, irb_approval_ref, approved_at,
      expires_at, status, plain_summary) VALUES ('TOMONI-REG', 1, 'Tomoni Registry (synthetic demo protocol)', 'Central IRB (demo)',
      'DEMO-IRB-0001', '2026-11-01', '2027-11-01', 'approved', ${JSON.stringify(SUMMARY)}::jsonb) RETURNING id`)
  ).rows;
  await db.execute(
    sql`INSERT INTO research.sponsor (id, name, kind) VALUES (${SPONSOR_DEMO_ID}, 'Demo Sponsor (synthetic)', 'sponsor')`,
  );
  const [trial] = (
    await db.execute<{ id: string }>(sql`INSERT INTO research.trial (sponsor_id, title, therapeutic_area)
      VALUES (${SPONSOR_DEMO_ID}, 'HEART-SA: heart disease in older South Asian adults (synthetic demo)', 'cardiology') RETURNING id`)
  ).rows;
  await db.execute(sql`INSERT INTO research.trial_criterion (trial_id, field, value) VALUES
    (${trial!.id}, 'age_band_min', '65'),
    (${trial!.id}, 'condition_any', '["coronary_artery_disease","heart_failure","atrial_fibrillation"]'),
    (${trial!.id}, 'language_any', '["hi","gu","pa","ta","bn"]')`);
  for (const [unit, cents] of [
    ['prescreen_completed', 15000],
    ['introduction_delivered', 40000],
    ['consent_prep_call', 25000],
    ['retention_participant_month', 15000],
  ] as const)
    await db.execute(sql`INSERT INTO research.service_rate (sponsor_id, unit, rate_cents, valid_from, set_by)
      VALUES (${SPONSOR_DEMO_ID}, ${unit}, ${cents}, '2026-11-01', ${admin!.id})`);
  // About 55% opt in (STRATEGY kill criterion: at least 50%). Raj and Kokila decide in the demo.
  let optedIn = 0;
  for (const p of people) {
    if (p.id === raj!.id || p.id === kokila!.id || rnd() > 0.55) continue;
    await db.execute(sql`INSERT INTO research.research_id (patient_id) VALUES (${p.id})`);
    await db.execute(sql`INSERT INTO research.research_consent (patient_id, protocol_id, given_by_kind, hipaa_authorization_ref,
      recording_permission, scope_speech_task, scope_trial_matching, scope_pgx_research, method, locale, given_at)
      VALUES (${p.id}, ${protocol!.id}, 'patient', 'HIPAA-AUTH-DEMO', ${rnd() < 0.7}, ${rnd() < 0.6}, true, ${rnd() < 0.3},
              'verbal_recorded', 'en', ${given})`);
    optedIn++;
  }
  const matched = await withScope('worker', systemScope('seed'), (w) => matchTrials(w, asOf));

  log(
    `seeded 3 US practices with ${people.length} patients, 1 India household, ${enrolled.length} APCM consents, ${DEMO_LOGINS.length} demo logins, ` +
      `${fills} fills, ${run.open} open warnings, ${optedIn} research opt-ins, ${matched.created} trial matches (as of ${asOf})`,
  );
}
