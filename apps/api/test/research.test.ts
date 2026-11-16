import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { systemScope } from '@tomoni/core';
import { closePools, ownerDb, schema, withScope } from '@tomoni/db';
import { matchTrials } from '@tomoni/trials';
import { buildServer } from '../src/server';
import { Client, makePracticeAndHousehold, ORIGIN, PASSWORD, totp } from './helpers';
import { hashPassword } from '../src/auth/password';

let app: Awaited<ReturnType<typeof buildServer>>;
let ids: Awaited<ReturnType<typeof makePracticeAndHousehold>>;
let rajId = '';
let protocolId = '';
let trialId = '';
let sponsorId = '';
const db = ownerDb();

async function login(role: string, scope: Record<string, string>, mfa = false) {
  const email = `${role}.${crypto.randomUUID().slice(0, 8)}@research.test`;
  const [u] = await db
    .insert(schema.userAccount)
    .values({ email, displayName: role, passwordHash: await hashPassword(PASSWORD) })
    .returning();
  await db.insert(schema.roleGrant).values({ userId: u!.id, role: role as never, ...scope });
  const c = new Client(app);
  await c.login(email);
  if (mfa) {
    const { secret } = (await c.req('POST', '/api/auth/mfa/enroll')).json();
    await c.req('POST', '/api/auth/mfa/enroll/confirm', { code: await totp(secret) });
  }
  return Object.assign(c, { userId: u!.id });
}

beforeAll(async () => {
  app = await buildServer({ config: { allowedOrigins: [ORIGIN], docs: false } });
  ids = await makePracticeAndHousehold();
  const [raj] = await db
    .insert(schema.patient)
    .values({
      practiceId: ids.practiceId,
      householdId: ids.householdId,
      name: 'Raj Patel',
      dob: '1953-01-01',
      birthYear: 1953,
      state: 'NJ',
      locale: 'gu',
      tz: 'America/New_York',
      medicareType: 'original',
    })
    .returning();
  rajId = raj!.id;
  await db.insert(schema.claim).values({
    patientId: rajId,
    kind: 'carrier',
    startDate: '2026-09-01',
    dxCodes: ['I25.10', 'E11.9'],
    source: 'manual',
    sourceRef: `rr-${rajId}`,
  });
  const p = await db.execute<{
    id: string;
  }>(sql`INSERT INTO research.protocol (code, version, title, irb_name, irb_approval_ref, approved_at,
    expires_at, status, plain_summary) VALUES ('REG-API', 1, 'Tomoni Registry', 'Central IRB', 'IRB-1', '2026-11-01', '2027-11-01', 'approved',
    '{"en":"Plain English summary","gu":"સરળ ગુજરાતી સારાંશ"}') RETURNING id`);
  protocolId = p.rows[0]!.id;
  const s = await db.execute<{ id: string }>(
    sql`INSERT INTO research.sponsor (name, kind) VALUES ('Acme Pharma', 'sponsor') RETURNING id`,
  );
  sponsorId = s.rows[0]!.id;
  const t = await db.execute<{ id: string }>(
    sql`INSERT INTO research.trial (sponsor_id, title, therapeutic_area) VALUES (${sponsorId}, 'HEART-SA', 'cardiology') RETURNING id`,
  );
  trialId = t.rows[0]!.id;
  await db.execute(sql`INSERT INTO research.trial_criterion (trial_id, field, value) VALUES
    (${trialId}, 'condition_any', '["coronary_artery_disease","heart_failure"]'), (${trialId}, 'language_any', '["gu","hi"]')`);
});
afterAll(async () => {
  await app.close();
  await closePools();
});

describe('research consent through the API', () => {
  it('a family member who is not a legal representative cannot consent for a parent', async () => {
    const asha = await login('family_member', { householdId: ids.householdId });
    const ov = (await asha.req('GET', '/api/research')).json();
    expect(ov.people[0]).toMatchObject({ name: 'Raj Patel', canConsentAs: null, consent: null });
    const r = await asha.req('POST', '/api/research/consents', {
      patientId: rajId,
      protocolId,
      scopes: { speechTask: true, trialMatching: true, pgxResearch: false },
      recordingPermission: true,
      signature: 'Asha Patel',
    });
    expect(r.statusCode).toBe(403);
  });

  it('the patient consents in his language; matching then finds him; the doctor introduces; the sponsor sees only rounded counts', async () => {
    const raj = await login('patient', { patientId: rajId });
    const ov = (await raj.req('GET', '/api/research')).json();
    expect(ov.protocol).toMatchObject({ summary: 'સરળ ગુજરાતી સારાંશ', irbName: 'Central IRB' });
    expect(ov.people[0].canConsentAs).toBe('patient');
    const c = await raj.req('POST', '/api/research/consents', {
      patientId: rajId,
      protocolId,
      scopes: { speechTask: false, trialMatching: true, pgxResearch: false },
      recordingPermission: false,
      signature: 'Raj Patel',
    });
    expect(c.statusCode, c.body).toBe(200);
    expect(await withScope('worker', systemScope('t'), (w) => matchTrials(w, '2026-11-15'))).toMatchObject({
      created: 1,
    });

    const doc = await login('physician', { practiceId: ids.practiceId }, true);
    const intros = (await doc.req('GET', '/api/desk/trial-intros')).json();
    expect(intros).toEqual([
      expect.objectContaining({ patientName: 'Raj Patel', trialTitle: 'HEART-SA', status: 'matched' }),
    ]);
    expect(
      (await doc.req('POST', `/api/desk/trial-intros/${intros[0].matchId}`, { outcome: 'introduced' }))
        .statusCode,
    ).toBe(204);
    const units = await db.execute<{ unit: string }>(sql`SELECT unit FROM research.service_event`);
    expect(units.rows.map((r) => r.unit)).toEqual(['introduction_delivered']);

    const sponsor = await login('sponsor_user', { sponsorId }, true);
    expect((await sponsor.req('GET', '/sponsor-api/trials')).json()).toEqual([
      expect.objectContaining({ title: 'HEART-SA' }),
    ]);
    const funnel = (await sponsor.req('GET', `/sponsor-api/trials/${trialId}/funnel`)).json();
    expect(funnel).toMatchObject({ matched: 0, introduced: null }); // one person: suppressed, never "1"
    const f = (
      await sponsor.req('POST', '/sponsor-api/feasibility', { conditions: ['coronary_artery_disease'] })
    ).json();
    expect(f).toMatchObject({ total: null, suppressedUnder: 11 });
    expect((await sponsor.req('POST', '/sponsor-api/feasibility', { birth_year: 1953 })).statusCode).toBe(
      400,
    );
    expect((await sponsor.req('GET', '/api/family/card')).statusCode).toBe(403);
  });

  it('only the research coordinator sees the funnel by name; each move records who made it', async () => {
    const coord = await login('research_coordinator', {}, true);
    const list = (await coord.req('GET', '/api/research/matches')).json();
    expect(list).toEqual([expect.objectContaining({ patientName: 'Raj Patel', status: 'introduced' })]);
    for (const [role, scope] of [
      ['admin', {}],
      ['nurse', { practiceId: ids.practiceId }],
    ] as const) {
      const c = await login(role, scope, true);
      expect((await c.req('GET', '/api/research/matches')).statusCode).toBe(403);
    }
    const r = await coord.req('POST', `/api/research/matches/${list[0].matchId}/stage`, {
      stage: 'consent_prep',
    });
    expect(r.statusCode).toBe(204);
    const { rows } = await db.execute<{
      by: string;
      purpose: string;
    }>(sql`SELECT details->>'by' AS by, purpose
      FROM audit.event WHERE entity_type = 'trial_match' AND details->>'status' = 'consent_prep'`);
    expect(rows).toEqual([{ by: coord.userId, purpose: 'research' }]);
    // The role cannot carry a care, family or sponsor scope.
    await expect(
      db.execute(sql`INSERT INTO auth.role_grant (user_id, role, practice_id)
        SELECT id, 'research_coordinator', ${ids.practiceId} FROM auth.user_account LIMIT 1`),
    ).rejects.toThrow();
  });

  it('withdrawal stops research at once: the doctor no longer sees the match', async () => {
    const raj = await login('patient', { patientId: rajId });
    const ov = (await raj.req('GET', '/api/research')).json();
    expect(
      (await raj.req('POST', `/api/research/consents/${ov.people[0].consent.id}/withdraw`)).statusCode,
    ).toBe(204);
    const doc = await login('physician', { practiceId: ids.practiceId }, true);
    // The match was 'introduced' anyway; prove the worker can no longer even see it.
    const n = await withScope(
      'worker',
      systemScope('t'),
      async (w) =>
        (await w.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM research.trial_match`)).rows[0]!.n,
    );
    expect(n).toBe(0);
    expect((await doc.req('GET', '/api/desk/trial-intros')).json()).toEqual([]);
  });
});
