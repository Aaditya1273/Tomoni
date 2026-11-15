import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import { EVENTS_CHANNEL } from '@tomoni/contracts';
import { closePools, env, hashFor, ownerDb, schema } from '@tomoni/db';
import { MockLLM } from '@tomoni/voice';
import { buildServer } from '../src/server';
import { Client, makePracticeAndHousehold, makeUser, ORIGIN, totp } from './helpers';

let app: Awaited<ReturnType<typeof buildServer>>;
let ids: Awaited<ReturnType<typeof makePracticeAndHousehold>>;
let other: Awaited<ReturnType<typeof makePracticeAndHousehold>>;
let patientId = '';
let noConsent = '';
let nurse: Client;
const pub = new Redis(env().REDIS_URL);

async function staff(role: 'nurse' | 'physician', practiceId: string) {
  const c = new Client(app);
  await c.login((await makeUser(role, { practiceId })).email);
  const { secret } = (await c.req('POST', '/api/auth/mfa/enroll')).json();
  await c.req('POST', '/api/auth/mfa/enroll/confirm', { code: await totp(secret) });
  return c;
}

async function patient(practiceId: string, householdId: string, consent: boolean) {
  const db = ownerDb();
  const [p] = await db
    .insert(schema.patient)
    .values({
      practiceId,
      householdId,
      name: 'Raj Patel',
      preferredName: 'Raj-bhai',
      dob: '1953-04-02',
      birthYear: 1953,
      phone: '201-555-0101',
      phoneHash: hashFor.phone('201-555-0101'),
      state: 'NJ',
      locale: 'en',
      tz: 'America/New_York',
      medicareType: 'original',
    })
    .returning();
  if (consent)
    await db.insert(schema.contactConsent).values({
      patientId: p!.id,
      channel: 'voice',
      phoneHash: hashFor.phone('201-555-0101'),
      recordingAllowed: true,
      givenByKind: 'patient',
      givenAt: new Date(),
    });
  return p!.id;
}

beforeAll(async () => {
  app = await buildServer({ config: { allowedOrigins: [ORIGIN], docs: false }, llm: new MockLLM() });
  ids = await makePracticeAndHousehold();
  other = await makePracticeAndHousehold();
  await ownerDb()
    .insert(schema.clinician)
    .values({ practiceId: ids.practiceId, kind: 'physician', displayName: 'Dr. Anil Rao' });
  patientId = await patient(ids.practiceId, ids.householdId, true);
  noConsent = await patient(ids.practiceId, ids.householdId, false);
  nurse = await staff('nurse', ids.practiceId);
});
afterAll(async () => {
  pub.disconnect();
  await app.close();
  await closePools();
});

describe('call simulator', () => {
  it('opens with the disclosure; a symptom raises a nurse flag, an outbox event and audit rows', async () => {
    const start = await nurse.req('POST', '/api/sim/calls', { patientId });
    expect(start.statusCode).toBe(200);
    const { callId, say } = start.json();
    expect(say[0]).toContain("Tomoni, an automated assistant calling from Dr. Anil Rao's office");

    const t1 = (await nurse.req('POST', `/api/sim/calls/${callId}/turn`, { text: "I'm okay" })).json();
    expect(t1.say).toEqual(["Have you taken today's medicines?"]);
    const t2 = (
      await nurse.req('POST', `/api/sim/calls/${callId}/turn`, { text: 'I feel dizzy since morning' })
    ).json();
    expect(t2).toMatchObject({
      ended: true,
      outcome: 'completed',
      flags: [{ class: 'symptom', urgency: 2 }],
    });

    const db = ownerDb();
    const [call] = await db
      .select()
      .from(schema.call)
      .where(sql`id = ${callId}`);
    expect(call).toMatchObject({
      step: 'ended',
      disclosurePlayed: true,
      channel: 'simulator',
      outcome: 'completed',
    });
    expect(JSON.parse(call!.transcript!).map((t: { who: string }) => t.who)).toEqual([
      'tomoni',
      'tomoni',
      'caller',
      'tomoni',
      'caller',
      'tomoni',
      'tomoni',
    ]);
    const raw = await db.execute<{ transcript: Buffer; slots: unknown }>(
      sql`SELECT transcript, slots FROM care.call WHERE id = ${callId}`,
    );
    expect(raw.rows[0]!.transcript.toString('utf8')).not.toContain('dizzy'); // encrypted at rest
    expect(JSON.stringify(raw.rows[0]!.slots)).not.toContain('Raj'); // no names in the state

    const ob = await db.execute<{
      topic: string;
      household_id: string | null;
      payload: Record<string, unknown>;
    }>(sql`SELECT topic, household_id, payload FROM care.outbox WHERE aggregate_id = ${t2.flags[0].id}`);
    expect(ob.rows).toEqual([
      { topic: 'flag.created', household_id: null, payload: { class: 'symptom', urgency: 2, patientId } },
    ]);
  });

  it('an emergency ends the call and the event also goes to the family', async () => {
    const { callId } = (await nurse.req('POST', '/api/sim/calls', { patientId })).json();
    const t = (
      await nurse.req('POST', `/api/sim/calls/${callId}/turn`, { text: 'mujhe seene mein dard hai' })
    ).json();
    expect(t).toMatchObject({
      ended: true,
      outcome: 'escalated',
      flags: [{ class: 'emergency', urgency: 1 }],
    });
    expect(t.say[0]).toContain('call 911');
    const ob = await ownerDb().execute<{ household_id: string }>(
      sql`SELECT household_id FROM care.outbox WHERE aggregate_id = ${t.flags[0].id}`,
    );
    expect(ob.rows[0]!.household_id).toBe(ids.householdId);
    expect((await nurse.req('POST', `/api/sim/calls/${callId}/turn`, { text: 'hello' })).statusCode).toBe(
      409,
    );
  });

  it('refuses patients without contact consent (rule 2.10), other practices, and families', async () => {
    expect((await nurse.req('POST', '/api/sim/calls', { patientId: noConsent })).json().error).toBe(
      'no_contact_consent',
    );
    const otherNurse = await staff('nurse', other.practiceId);
    expect((await otherNurse.req('POST', '/api/sim/calls', { patientId })).statusCode).toBe(404);
    const fam = new Client(app);
    await fam.login((await makeUser('family_member', { householdId: ids.householdId })).email);
    expect((await fam.req('POST', '/api/sim/calls', { patientId })).statusCode).toBe(403);
  });

  it('does not exist in production', async () => {
    const prod = await buildServer({ config: { allowedOrigins: [ORIGIN], docs: false, simulator: false } });
    const c = new Client(prod);
    expect((await c.req('POST', '/api/sim/calls', { patientId })).statusCode).toBe(404);
    await prod.close();
  });
});

describe('nurse flags on the desk', () => {
  it('the practice nurse sees open flags with the caller’s words; another practice sees none', async () => {
    const flags = (await nurse.req('GET', '/api/desk/flags')).json();
    expect(flags.map((f: { class: string }) => f.class)).toEqual(['emergency', 'symptom']);
    expect(flags[1]).toMatchObject({
      patientName: 'Raj Patel',
      excerpt: 'I feel dizzy since morning',
      status: 'open',
    });
    const otherNurse = await staff('nurse', other.practiceId);
    expect((await otherNurse.req('GET', '/api/desk/flags')).json()).toEqual([]);
  });

  it('acknowledge, then resolve with a note; resolved flags leave the list', async () => {
    const [flag] = (await nurse.req('GET', '/api/desk/flags')).json();
    expect((await nurse.req('POST', `/api/desk/flags/${flag.id}/acknowledge`)).statusCode).toBe(204);
    expect(
      (await nurse.req('POST', `/api/desk/flags/${flag.id}/resolve`, { note: 'Called 911 with daughter.' }))
        .statusCode,
    ).toBe(204);
    expect((await nurse.req('GET', '/api/desk/flags')).json().map((f: { id: string }) => f.id)).not.toContain(
      flag.id,
    );
    expect(
      (await nurse.req('POST', `/api/desk/flags/${flag.id}/resolve`, { note: 'again' })).statusCode,
    ).toBe(404);
  });
});

describe('live events (SSE)', () => {
  it('streams events for the viewer’s practice only, with no PHI', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const cookie = [...nurse.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { cookie } });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const ev = (practiceId: string, id: number) => ({
      id,
      topic: 'flag.created',
      aggregateType: 'nurse_flag',
      aggregateId: '01a1deb5-7ebe-7f0b-9f19-c195d26cf70d',
      practiceId,
      householdId: null,
      payload: { class: 'symptom', urgency: 2 },
    });
    await new Promise((r) => setTimeout(r, 200));
    await pub.publish(EVENTS_CHANNEL, JSON.stringify(ev(other.practiceId, 1)));
    await pub.publish(EVENTS_CHANNEL, JSON.stringify(ev(ids.practiceId, 2)));
    let text = '';
    while (!text.includes('\n\nid: 2') && !text.includes('id: 2\n'))
      text += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    expect(text).toContain('event: flag.created');
    expect(text).not.toContain('id: 1\n');
  });
});
