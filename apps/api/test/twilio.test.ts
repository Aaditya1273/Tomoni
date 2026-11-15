import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closePools, hashFor, ownerDb, schema } from '@tomoni/db';
import { MockLLM, twilioSignature } from '@tomoni/voice';
import { buildServer } from '../src/server';
import { makePracticeAndHousehold, ORIGIN } from './helpers';

const TOKEN = 'test-twilio-token';
const PUBLIC = 'https://api.tomoni.test';
let app: Awaited<ReturnType<typeof buildServer>>;
let callId = '';

async function scheduledCall() {
  const db = ownerDb();
  const ids = await makePracticeAndHousehold();
  const [p] = await db
    .insert(schema.patient)
    .values({
      practiceId: ids.practiceId,
      householdId: ids.householdId,
      name: 'Lata Iyer',
      dob: '1950-01-01',
      birthYear: 1950,
      phone: '732-555-0103',
      phoneHash: hashFor.phone('732-555-0103'),
      state: 'NJ',
      locale: 'hi',
      tz: 'America/New_York',
      medicareType: 'original',
    })
    .returning();
  await db.insert(schema.contactConsent).values({
    patientId: p!.id,
    channel: 'voice',
    phoneHash: hashFor.phone('732-555-0103'),
    givenByKind: 'patient',
    givenAt: new Date(),
  });
  const [c] = await db
    .insert(schema.call)
    .values({ patientId: p!.id, channel: 'voice', locale: 'hi', scriptVersion: 'daily-call.v2' })
    .returning();
  return c!.id;
}

const post = (path: string, params: Record<string, string>, sign = true) =>
  app.inject({
    method: 'POST',
    url: path,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(sign ? { 'x-twilio-signature': twilioSignature(TOKEN, `${PUBLIC}${path}`, params) } : {}),
    },
    payload: new URLSearchParams(params).toString(),
  });

beforeAll(async () => {
  app = await buildServer({
    config: { allowedOrigins: [ORIGIN], docs: false, twilio: { authToken: TOKEN, publicApiOrigin: PUBLIC } },
    llm: new MockLLM(),
  });
  callId = await scheduledCall();
});
afterAll(async () => {
  await app.close();
  await closePools();
});

describe('Twilio voice webhooks', () => {
  it('refuses unsigned or forged requests', async () => {
    expect((await post(`/api/voice/twilio/${callId}/answer`, { CallSid: 'CA1' }, false)).statusCode).toBe(
      403,
    );
    const forged = await app.inject({
      method: 'POST',
      url: `/api/voice/twilio/${callId}/answer`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'AAAA' },
      payload: 'CallSid=CA1',
    });
    expect(forged.statusCode).toBe(403);
  });

  it('answers with the disclosure in the patient’s language and gathers speech', async () => {
    const r = await post(`/api/voice/twilio/${callId}/answer`, { CallSid: 'CA1', AnsweredBy: 'human' });
    expect(r.headers['content-type']).toContain('text/xml');
    expect(r.body).toContain('<Say language="hi-IN">नमस्ते Lata।');
    expect(r.body).toContain(`<Gather input="speech" language="hi-IN"`);
    expect(r.body).toContain(`action="${PUBLIC}/api/voice/twilio/${callId}/turn"`);
  });

  it('a spoken emergency hangs up after the 911 script and raises the flag', async () => {
    const r = await post(`/api/voice/twilio/${callId}/turn`, {
      CallSid: 'CA1',
      SpeechResult: 'सीने में दर्द हो रहा है',
    });
    expect(r.body).toContain('911');
    expect(r.body).toContain('<Hangup/>');
    const flags = await ownerDb().execute<{ class: string; channel: string }>(
      sql`SELECT class, channel FROM care.nurse_flag WHERE call_id = ${callId}`,
    );
    expect(flags.rows).toEqual([{ class: 'emergency', channel: 'voice' }]);
  });

  it('a machine gets a voicemail with no name or health detail', async () => {
    const id = await scheduledCall();
    const r = await post(`/api/voice/twilio/${id}/answer`, { CallSid: 'CA2', AnsweredBy: 'machine_start' });
    expect(r.body).not.toContain('Lata');
    expect(r.body).toContain('<Hangup/>');
    const [c] = await ownerDb()
      .select()
      .from(schema.call)
      .where(sql`id = ${id}`);
    expect(c).toMatchObject({ outcome: 'voicemail', disclosurePlayed: false });
  });

  it('TwiML escapes caller-influenced text', async () => {
    const id = await scheduledCall();
    await post(`/api/voice/twilio/${id}/answer`, { CallSid: 'CA3', AnsweredBy: 'human' });
    const r = await post(`/api/voice/twilio/${id}/turn`, {
      CallSid: 'CA3',
      SpeechResult: '</Say><Dial>+15550000000</Dial>',
    });
    expect(r.body).not.toContain('<Dial>');
  });
});
