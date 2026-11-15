import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopeFromGrants, systemScope, type RoleGrant } from '@tomoni/core';
import { closePools, ownerDb, pool, schema, sql, withScope } from '../src';
import { pgError } from './fixtures';

const db = ownerDb();
const g = (role: RoleGrant['role'], ids: Partial<RoleGrant> = {}): RoleGrant => ({
  role,
  practiceId: null,
  householdId: null,
  patientId: null,
  sponsorId: null,
  ...ids,
});
let practiceId = '';
let protocolId = '';
let sponsorA = '';
let sponsorB = '';
let trialA = '';
const patients: { id: string; householdId: string }[] = [];
const users: Record<string, string> = {};

async function user(name: string) {
  const [u] = await db
    .insert(schema.userAccount)
    .values({ email: `${name}@research.test`, displayName: name })
    .returning();
  users[name] = u!.id;
  return u!.id;
}
const consent = (patientId: string, by = users.raj!, o: Record<string, unknown> = {}) =>
  sql`INSERT INTO research.research_consent (patient_id, protocol_id, given_by_kind, hipaa_authorization_ref,
        recording_permission, scope_speech_task, scope_trial_matching, scope_pgx_research, method, locale, recorded_by)
      VALUES (${patientId}, ${protocolId}, ${(o.kind as string) ?? 'patient'}, 'HIPAA-AUTH-v1', true, true, true, false,
              'e_sign', 'gu', ${by}) RETURNING id`;

beforeAll(async () => {
  await db.execute(sql`TRUNCATE research.service_event, research.trial_match, research.trial_criterion, research.trial,
    research.service_rate, research.sponsor, research.research_consent, research.research_id, research.protocol CASCADE`);
  const [pr] = await db
    .insert(schema.practice)
    .values({ name: 'Research Practice', tz: 'America/New_York' })
    .returning();
  practiceId = pr!.id;
  // 60 patients: ages spread across bands; half have heart failure, a few speak Gujarati.
  for (let i = 0; i < 60; i++) {
    const [h] = await db
      .insert(schema.household)
      .values({ displayName: `H${i}`, primaryLocale: 'en' })
      .returning();
    const [p] = await db
      .insert(schema.patient)
      .values({
        practiceId,
        householdId: h!.id,
        name: `P${i}`,
        dob: '1950-01-01',
        birthYear: 1946 + (i % 15),
        state: 'NJ',
        locale: i < 3 ? 'gu' : 'en',
        tz: 'America/New_York',
        medicareType: 'original',
      })
      .returning();
    patients.push({ id: p!.id, householdId: h!.id });
    await db.insert(schema.claim).values({
      patientId: p!.id,
      kind: 'carrier',
      startDate: '2026-09-01',
      dxCodes: i % 2 ? ['I50.9', 'E11.9'] : ['E11.9'],
      source: 'manual',
      sourceRef: `r-${p!.id}`,
    });
  }
  const [proto] = (
    await db.execute<{
      id: string;
    }>(sql`INSERT INTO research.protocol (code, version, title, irb_name, irb_approval_ref,
      approved_at, expires_at, status, plain_summary) VALUES ('TOMONI-REG', 1, 'Tomoni Registry', 'Central IRB', 'IRB-2027-001',
      '2026-11-01', '2027-11-01', 'approved', '{"en":"…"}') RETURNING id`)
  ).rows;
  protocolId = proto!.id;
  await user('raj');
  await user('asha');
  await user('nurse');
  await user('verifier');
  for (const p of patients)
    await db.execute(sql`INSERT INTO research.research_id (patient_id) VALUES (${p.id})`);
  // Everyone but the last 10 consents to trial matching.
  for (const p of patients.slice(0, 50)) await db.execute(consent(p.id));
  const s = await db.execute<{ id: string }>(
    sql`INSERT INTO research.sponsor (name, kind) VALUES ('Sponsor A','sponsor'), ('Sponsor B','cro') RETURNING id`,
  );
  [sponsorA, sponsorB] = s.rows.map((r) => r.id) as [string, string];
  const t = await db.execute<{ id: string }>(
    sql`INSERT INTO research.trial (sponsor_id, title, therapeutic_area) VALUES (${sponsorA}, 'HF study', 'heart failure') RETURNING id`,
  );
  trialA = t.rows[0]!.id;
  // 13 matches in one stage, 4 in another: one shown (rounded), one hidden.
  const pids = await db.execute<{ research_pid: string }>(
    sql`SELECT research_pid FROM research.research_id WHERE patient_id = ANY(${sql.param(patients.slice(0, 17).map((p) => p.id))}::uuid[])`,
  );
  for (const [i, r] of pids.rows.entries())
    await db.execute(
      sql`INSERT INTO research.trial_match (trial_id, research_pid, status) VALUES (${trialA}, ${r.research_pid}, ${i < 13 ? 'matched' : 'introduced'})`,
    );
});
afterAll(closePools);

const asSponsor = <T>(sponsorId: string, fn: Parameters<typeof withScope<T>>[2]) =>
  withScope('sponsor', scopeFromGrants(users.raj!, [g('sponsor_user', { sponsorId })]), fn);

describe('rule 2.5: research is impossible without active research consent', () => {
  it('a match is visible with consent and gone on the next statement after withdrawal', async () => {
    const p = patients[0]!;
    const visible = () =>
      withScope(
        'worker',
        systemScope('t'),
        async (w) =>
          (
            await w.execute<{
              n: number;
            }>(sql`SELECT count(*)::int AS n FROM research.trial_match m JOIN research.research_id r
          ON r.research_pid = m.research_pid WHERE r.patient_id = ${p.id}`)
          ).rows[0]!.n,
      );
    expect(await visible()).toBe(1);
    await db.execute(sql`UPDATE research.research_consent SET withdrawn_at = now(), withdrawal_recorded_by = ${users.raj}
                         WHERE patient_id = ${p.id}`);
    expect(await visible()).toBe(0);
    // A withdrawn consent can't be revived.
    expect(
      await pgError(
        db.execute(sql`UPDATE research.research_consent SET withdrawn_at = NULL WHERE patient_id = ${p.id}`),
      ),
    ).toMatch(/withdrawn consent/);
  });

  it('without consent, the worker cannot even write a match', async () => {
    const p = patients[59]!; // never consented
    const [r] = (
      await db.execute<{ research_pid: string }>(
        sql`SELECT research_pid FROM research.research_id WHERE patient_id = ${p.id}`,
      )
    ).rows;
    expect(
      await pgError(
        withScope('worker', systemScope('t'), (w) =>
          w.execute(
            sql`INSERT INTO research.trial_match (trial_id, research_pid) VALUES (${trialA}, ${r!.research_pid})`,
          ),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('an expired or unapproved protocol switches every consent off', async () => {
    const p = patients[1]!;
    const has = async () =>
      (
        await db.execute<{ ok: boolean }>(
          sql`SELECT research.has_active_consent(${p.id}, 'trial_matching') AS ok`,
        )
      ).rows[0]!.ok;
    expect(await has()).toBe(true);
    await db.execute(sql`UPDATE research.protocol SET status = 'suspended' WHERE id = ${protocolId}`);
    expect(await has()).toBe(false);
    await db.execute(sql`UPDATE research.protocol SET status = 'approved' WHERE id = ${protocolId}`);
    expect(await has()).toBe(true);
    expect(
      (
        await db.execute<{ ok: boolean }>(
          sql`SELECT research.has_active_consent(${p.id}, 'pgx_research') AS ok`,
        )
      ).rows[0]!.ok,
    ).toBe(false); // that use was not opted into
  });

  it('a consent is a record: its scopes can’t be edited', async () => {
    expect(
      await pgError(
        db.execute(
          sql`UPDATE research.research_consent SET scope_pgx_research = true WHERE patient_id = ${patients[2]!.id}`,
        ),
      ),
    ).toMatch(/only withdrawal/);
  });
});

describe('rule 2.6: who may consent', () => {
  const p = () => patients[55]!;
  it('the patient may; a nurse may not; a family member is not a representative by default', async () => {
    await db.insert(schema.roleGrant).values({ userId: users.raj!, role: 'patient', patientId: p().id });
    await withScope('app', scopeFromGrants(users.raj!, [g('patient', { patientId: p().id })]), (a) =>
      a.execute(consent(p().id, users.raj!)),
    );
    await db.execute(sql`DELETE FROM research.research_consent WHERE patient_id = ${p().id}`);
    expect(
      await pgError(
        withScope('app', scopeFromGrants(users.nurse!, [g('nurse', { practiceId })]), (a) =>
          a.execute(consent(p().id, users.nurse!)),
        ),
      ),
    ).toMatch(/row-level security/);
    const asha = scopeFromGrants(users.asha!, [g('family_member', { householdId: p().householdId })]);
    expect(await pgError(withScope('app', asha, (a) => a.execute(consent(p().id, users.asha!))))).toMatch(
      /row-level security/,
    );
  });

  it('a verified, current legal representative may, recorded as such', async () => {
    const [fm] = await db
      .insert(schema.familyMember)
      .values({
        householdId: p().householdId,
        userId: users.asha!,
        displayName: 'Asha',
        relationship: 'daughter',
      })
      .returning();
    const [rep] = await db
      .insert(schema.representative)
      .values({
        patientId: p().id,
        familyMemberId: fm!.id,
        legalBasis: 'healthcare_poa',
        validFrom: '2026-01-01',
        verifiedBy: users.verifier!,
      })
      .returning();
    const asha = scopeFromGrants(users.asha!, [g('family_member', { householdId: p().householdId })]);
    await withScope('app', asha, (a) =>
      a.execute(sql`INSERT INTO research.research_consent (patient_id, protocol_id, given_by_kind, given_by_id, hipaa_authorization_ref,
        recording_permission, scope_speech_task, scope_trial_matching, scope_pgx_research, method, locale, recorded_by)
        VALUES (${p().id}, ${protocolId}, 'representative', ${rep!.id}, 'HIPAA-AUTH-v1', false, false, true, false, 'e_sign', 'en', ${users.asha})`),
    );
  });
});

describe('rule 2.9: sponsors see de-identified aggregates only', () => {
  it('the sponsor role cannot read any table', async () => {
    for (const t of [
      'care.patient',
      'care.claim',
      'research.trial_match',
      'research.research_id',
      'research.research_consent',
      'audit.event',
    ])
      expect(await pgError(pool('sponsor').query(`SELECT 1 FROM ${t} LIMIT 1`))).toMatch(/permission denied/);
  });

  it('feasibility suppresses 1–10, rounds to 5, and hides a second band when one is hidden', async () => {
    const r = await asSponsor(
      sponsorA,
      async (s) =>
        (
          await s.execute<{ f: { total: number; byAgeBand: { band: string; n: number | null }[] } }>(
            sql`SELECT sponsor.feasibility('{"conditions":["heart_failure"]}') AS f`,
          )
        ).rows[0]!.f,
    );
    expect(r.total % 5).toBe(0);
    const ns = r.byAgeBand.map((b) => b.n).filter((n): n is number => n !== null);
    expect(ns.every((n) => n === 0 || (n >= 10 && n % 5 === 0))).toBe(true);
    expect(r.byAgeBand.filter((b) => b.n === null).length).not.toBe(1); // never exactly one hidden cell
  });

  it('a differencing attack can’t recover a small group', async () => {
    // Gujarati speakers are 3 people. Ask "everyone" and "everyone but Gujarati speakers" and subtract.
    const f = async (criteria: object) =>
      asSponsor(
        sponsorA,
        async (s) =>
          (
            await s.execute<{ f: { total: number | null } }>(
              sql`SELECT sponsor.feasibility(${JSON.stringify(criteria)}::jsonb) AS f`,
            )
          ).rows[0]!.f.total,
      );
    const all = await f({});
    const en = await f({ languages: ['en'] });
    const gu = await f({ languages: ['gu'] });
    expect(gu).toBeNull(); // asked directly: suppressed
    expect(all! - en!).not.toBe(3); // by subtraction: rounding hides it
    expect(Math.abs(all! - en! - 3)).toBeLessThanOrEqual(5);
  });

  it('closed vocabulary: anything else is refused; no scope, no answer', async () => {
    expect(
      await pgError(
        asSponsor(sponsorA, (s) => s.execute(sql`SELECT sponsor.feasibility('{"birth_year": 1953}')`)),
      ),
    ).toMatch(/criteria outside the allowed set/);
    expect(await pgError(pool('sponsor').query(`SELECT sponsor.trials()`))).toMatch(/no sponsor scope/);
  });

  it('the funnel is per stage, suppressed, and only for the sponsor’s own trial', async () => {
    const own = await asSponsor(
      sponsorA,
      async (s) =>
        (await s.execute<{ f: Record<string, number | null> }>(sql`SELECT sponsor.funnel(${trialA}) AS f`))
          .rows[0]!.f,
    );
    expect(own).toMatchObject({ matched: 10, introduced: null, randomized: 0 }); // 12 consented matched → 10; 4 → hidden
    const other = await asSponsor(
      sponsorB,
      async (s) => (await s.execute<{ f: unknown }>(sql`SELECT sponsor.funnel(${trialA}) AS f`)).rows[0]!.f,
    );
    expect(other).toBeNull();
  });
});

describe('D-010 and rule 2.7: work-based fees only', () => {
  it('there is no fee unit for a randomized participant', async () => {
    const { rows } = await db.execute<{
      def: string;
    }>(sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid IN ('research.service_rate'::regclass, 'research.service_event'::regclass) AND contype = 'c'`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.def).not.toMatch(/random/i);
  });
});
