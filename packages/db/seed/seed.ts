import { sql } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { hashFor, ownerDb, realDataEnabled, schema } from '../src';
import { POOLS, type Lang } from './names';

/**
 * Deterministic synthetic world (DATA_MODEL "Synthetic seed", DECISIONS D-012).
 * 3 practices, 500 patients: 20 scripted households (named families with logins) + single-patient
 * households for the rest. Same output on every machine: seeded PRNG, fixed reference date.
 * Medicines, fills and warnings arrive with Phase 2.
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
  const patientRow = (
    practiceId: string,
    householdId: string,
    name: string,
    locale: Lang,
    birthYear: number,
  ) => {
    const ph = phone();
    const month = 1 + Math.floor(rnd() * 12);
    const day = 1 + Math.floor(rnd() * 28);
    return {
      practiceId,
      householdId,
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
      ...patientRow(rao.id, patel!.id, 'Raj Patel', 'gu', 1953),
      preferredName: 'Raj-bhai',
      medicareType: 'original',
    })
    .returning();
  await db.insert(schema.patient).values(patientRow(rao.id, patel!.id, 'Kokila Patel', 'gu', 1956));
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

  // ── Staff and logins ───────────────────────────────────────────────────────
  for (const d of DEMO_LOGINS) {
    const [u] = await db
      .insert(schema.userAccount)
      .values({ email: d.email, displayName: d.name, passwordHash: pw })
      .returning();
    const scope =
      d.role === 'family_member'
        ? { householdId: patel!.id }
        : d.role === 'patient'
          ? { patientId: raj!.id }
          : d.role === 'ops_agent'
            ? { practiceId: sunrise.id }
            : d.role === 'sponsor_user'
              ? { sponsorId: SPONSOR_DEMO_ID }
              : d.role === 'admin'
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
        .where(sql`id = ${asha!.id}`);
  }
  for (const [p, name] of [
    [sunrise, 'Dr. Meena Iyer'],
    [lakeview, 'Dr. Thomas Grant'],
  ] as const) {
    await db.insert(schema.clinician).values({ practiceId: p.id, kind: 'physician', displayName: name });
  }

  const [{ n }] = (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM care.patient`))
    .rows as [{ n: number }];
  log(
    `seeded 3 practices, ${n} patients, ${enrolled.length} APCM consents, ${DEMO_LOGINS.length} demo logins`,
  );
}
