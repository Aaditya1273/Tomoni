import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closePools, ownerDb, schema } from '@tomoni/db';
import { buildServer } from '../src/server';
import { Client, makePracticeAndHousehold, makeUser, ORIGIN } from './helpers';

let app: Awaited<ReturnType<typeof buildServer>>;
let ids: Awaited<ReturnType<typeof makePracticeAndHousehold>>;
let asha: Client;

beforeAll(async () => {
  app = await buildServer({
    config: { allowedOrigins: [ORIGIN], docs: false, publicOrigin: 'https://app.tomoni.test' },
  });
  ids = await makePracticeAndHousehold();
  const db = ownerDb();
  const [p] = await db
    .insert(schema.patient)
    .values({
      practiceId: ids.practiceId,
      householdId: ids.householdId,
      name: 'Raj Patel',
      dob: '1953-01-01',
      birthYear: 1953,
      state: 'NJ',
      locale: 'en',
      tz: 'America/New_York',
      medicareType: 'original',
    })
    .returning();
  const day = (n: number) => new Date(Date.now() - n * 86_400_000);
  for (const n of [1, 2, 4])
    // a gap on day 3: the shield covers it
    await db.insert(schema.call).values({
      patientId: p!.id,
      channel: 'voice',
      locale: 'en',
      scriptVersion: 'v1',
      step: 'ended',
      disclosurePlayed: true,
      outcome: 'completed',
      startedAt: day(n),
    });
  await db.insert(schema.nurseFlag).values({
    patientId: p!.id,
    channel: 'voice',
    class: 'symptom',
    matchedRule: 'r',
    excerpt: 'my private words',
    urgency: 2,
  });
  asha = new Client(app);
  await asha.login((await makeUser('family_member', { householdId: ids.householdId })).email);
});
afterAll(async () => {
  await app.close();
  await closePools();
});

describe('family activity', () => {
  it('lists what happened in plain facts, with a streak and the week, never the caller’s words', async () => {
    const r = await asha.req('GET', '/api/family/activity');
    const a = r.json();
    expect(a.events.map((e: { what: string }) => e.what)).toEqual(
      expect.arrayContaining(['call.completed', 'flag.symptom']),
    );
    expect(r.body).not.toContain('my private words');
    expect(a.streaks[0]).toMatchObject({ patientName: 'Raj Patel', callStreak: 3, shieldUsed: true });
    expect(a.week).toMatchObject({ calls: 3 });
  });
});

describe('invites', () => {
  it('a sibling invite is a single-use link that creates a household login', async () => {
    const inv = (
      await asha.req('POST', '/api/family/invites', { kind: 'sibling', email: 'Nikhil@Example.com' })
    ).json();
    expect(inv.acceptUrl).toMatch(/^https:\/\/app\.tomoni\.test\/invite\/[A-Za-z0-9_-]{40,}$/);
    const token = inv.acceptUrl.split('/').pop();
    const anon = new Client(app);
    const body = { token, displayName: 'Nikhil Patel', password: 'a long enough password' };
    expect((await anon.req('POST', '/api/invites/accept', body)).statusCode).toBe(204);
    expect((await anon.req('POST', '/api/invites/accept', body)).statusCode).toBe(400); // single use

    const nikhil = new Client(app);
    expect((await nikhil.login('nikhil@example.com', 'a long enough password')).statusCode).toBe(200);
    expect(
      (await nikhil.req('GET', '/api/family/card')).json().patients.map((p: { name: string }) => p.name),
    ).toEqual(['Raj Patel']);
  });

  it('expired or forged links do nothing; the target e-mail is encrypted at rest', async () => {
    const inv = (
      await asha.req('POST', '/api/family/invites', { kind: 'sibling', email: 'late@example.com' })
    ).json();
    await ownerDb().execute(
      sql`UPDATE care.invite SET expires_at = now() - interval '1 minute' WHERE id = ${inv.id}`,
    );
    const anon = new Client(app);
    const token = inv.acceptUrl.split('/').pop();
    expect(
      (
        await anon.req('POST', '/api/invites/accept', {
          token,
          displayName: 'L',
          password: 'a long enough password',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await anon.req('POST', '/api/invites/accept', {
          token: 'x'.repeat(43),
          displayName: 'L',
          password: 'a long enough password',
        })
      ).statusCode,
    ).toBe(400);
    const raw = await ownerDb().execute<{ target: Buffer }>(
      sql`SELECT target FROM care.invite WHERE id = ${inv.id}`,
    );
    expect(raw.rows[0]!.target.toString('utf8')).not.toContain('late@example.com');
  });

  it('a doctor invite has no link; staff cannot invite into a household', async () => {
    expect(
      (await asha.req('POST', '/api/family/invites', { kind: 'doctor', email: 'dr@clinic.test' })).json()
        .acceptUrl,
    ).toBeNull();
    const nurse = new Client(app);
    await nurse.login((await makeUser('nurse', { practiceId: ids.practiceId })).email);
    expect(
      (await nurse.req('POST', '/api/family/invites', { kind: 'sibling', email: 'x@y.test' })).statusCode,
    ).toBe(403);
  });
});
