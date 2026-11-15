import { sql } from 'drizzle-orm';
import { scopeFromGrants, type RoleGrant, type RequestScope } from '@tomoni/core';
import { hashFor, ownerDb, schema } from '../src';

const { practice, household, patient, familyMember, careConsent, userAccount, roleGrant } = schema;

/**
 * Two practices, three households:
 *   A (offshore ops OFF): households H1 (Raj, Meera), H3 (Sam)
 *   B (offshore ops ON):  household H2 (Lata)
 */
export async function buildWorld() {
  const db = ownerDb();
  await db.execute(sql`TRUNCATE care.care_consent, care.contact_consent, care.representative, care.family_member,
    care.patient, care.household, care.clinician, care.practice, auth.role_grant, auth.session,
    auth.identity, auth.user_account CASCADE`);

  const [A] = await db
    .insert(practice)
    .values({ name: 'Rao Family Medicine', tz: 'America/New_York' })
    .returning();
  const [B] = await db
    .insert(practice)
    .values({ name: 'Edison Primary Care', tz: 'America/New_York', offshoreOpsAccess: true })
    .returning();
  const [H1, H2, H3] = await db
    .insert(household)
    .values([
      { displayName: 'Patel', primaryLocale: 'gu' },
      { displayName: 'Iyer', primaryLocale: 'ta' },
      { displayName: 'Brown', primaryLocale: 'en' },
    ])
    .returning();

  const mk = (name: string, practiceId: string, householdId: string, phone: string) => ({
    practiceId,
    householdId,
    name,
    dob: '1953-04-02',
    birthYear: 1953,
    phone,
    phoneHash: hashFor.phone(phone),
    state: 'NJ',
    locale: 'gu',
    tz: 'America/New_York',
    medicareType: 'original' as const,
  });
  const [raj, meera, lata, sam] = await db
    .insert(patient)
    .values([
      mk('Raj Patel', A!.id, H1!.id, '201-555-0101'),
      mk('Meera Patel', A!.id, H1!.id, '201-555-0102'),
      mk('Lata Iyer', B!.id, H2!.id, '732-555-0103'),
      mk('Sam Brown', A!.id, H3!.id, '201-555-0104'),
    ])
    .returning();

  await db
    .insert(familyMember)
    .values({ householdId: H1!.id, displayName: 'Asha', relationship: 'daughter' });
  await db.insert(careConsent).values({
    patientId: raj!.id,
    practiceId: A!.id,
    givenByKind: 'patient',
    method: 'verbal_recorded',
    copayDisclosed: true,
    givenAt: new Date(),
  });

  const users: Record<string, string> = {};
  for (const u of ['asha', 'drrao', 'nurseA', 'nurseB', 'opsA', 'opsB', 'admin', 'raj', 'sponsor']) {
    const [row] = await db
      .insert(userAccount)
      .values({ email: `${u}@test.local`, displayName: u })
      .returning({ id: userAccount.id });
    users[u] = row!.id;
  }
  const grants: Record<string, RoleGrant[]> = {
    asha: [grant('family_member', { householdId: H1!.id })],
    drrao: [grant('physician', { practiceId: A!.id })],
    nurseA: [grant('nurse', { practiceId: A!.id })],
    nurseB: [grant('nurse', { practiceId: B!.id })],
    opsA: [grant('ops_agent', { practiceId: A!.id })],
    opsB: [grant('ops_agent', { practiceId: B!.id })],
    admin: [grant('admin')],
    raj: [grant('patient', { patientId: raj!.id })],
    sponsor: [grant('sponsor_user', { sponsorId: '00000000-0000-7000-8000-000000000001' })],
  };
  for (const [u, gs] of Object.entries(grants)) {
    for (const g of gs) await db.insert(roleGrant).values({ userId: users[u]!, ...g });
  }
  const scope = (u: keyof typeof grants): RequestScope => scopeFromGrants(users[u]!, grants[u]!);

  return {
    A: A!,
    B: B!,
    H1: H1!,
    H2: H2!,
    H3: H3!,
    raj: raj!,
    meera: meera!,
    lata: lata!,
    sam: sam!,
    users,
    scope,
  };
}

function grant(role: RoleGrant['role'], ids: Partial<RoleGrant> = {}): RoleGrant {
  return { role, practiceId: null, householdId: null, patientId: null, sponsorId: null, ...ids };
}

/** Postgres error text of a rejected query (Drizzle wraps it as "Failed query ..." with the pg error as cause). */
export async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    return `${err.message} ${err.cause?.message ?? ''}`;
  }
  throw new Error('expected the query to fail');
}
