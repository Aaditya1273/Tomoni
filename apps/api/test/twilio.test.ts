import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE } from '@tomoni/contracts';
import { closePools, env, hashFor, ownerDb, schema } from '@tomoni/db';
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
    config: {
      allowedOrigins: [ORIGIN],
      docs: false,
      twilio: { authToken: TOKEN, publicApiOrigin: PUBLIC, speechAudio: false },
    },
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

describe('Voice Lab audio on a phone call (D-032)', () => {
  const calls: string[] = [];
  let fail = false;
  const REC = `RE${'a'.repeat(32)}`;
  const CALL = `CA${'b'.repeat(32)}`;
  const tel = {
    mode: 'twilio' as const,
    placeCall: async () => ({ ref: CALL, dialed: true }),
    sendSms: async () => ({ ref: 'x', sent: true }),
    startRecording: async (c: string) => {
      calls.push(`start ${c}`);
      if (fail) throw new Error('twilio down');
      return { ref: REC };
    },
    stopRecording: async (c: string) => (calls.push(`stop ${c}`), { ref: REC }),
    fetchRecording: async () => Buffer.alloc(0),
    deleteRecording: async (r: string) => void calls.push(`delete ${r}`),
    deleteCallRecordings: async (c: string) => (calls.push(`delete all ${c}`), 1),
  };
  let audioApp: Awaited<ReturnType<typeof buildServer>>;
  const queue = new Queue(QUEUE, {
    connection: new Redis(env().REDIS_URL),
    prefix: process.env.TOMONI_QUEUE_PREFIX!,
  });

  const consentedCall = async (recordingAllowed: boolean) => {
    const db = ownerDb();
    const ids = await makePracticeAndHousehold();
    const [p] = await db
      .insert(schema.patient)
      .values({
        practiceId: ids.practiceId,
        householdId: ids.householdId,
        name: 'Meera Rao',
        dob: '1950-01-01',
        birthYear: 1950,
        state: 'NJ',
        locale: 'en',
        tz: 'America/New_York',
        medicareType: 'original',
      })
      .returning();
    await db.insert(schema.contactConsent).values({
      patientId: p!.id,
      channel: 'voice',
      phoneHash: hashFor.phone(`732-555-${Math.floor(Math.random() * 9000) + 1000}`),
      recordingAllowed,
      givenByKind: 'patient',
      givenAt: new Date(),
    });
    const { rows } = await db.execute<{ id: string }>(sql`INSERT INTO research.protocol (code, version, title,
      irb_name, irb_approval_ref, approved_at, expires_at, status, plain_summary) VALUES (${`VL-${p!.id}`}, 1, 'Voice Lab',
      'IRB', 'IRB-1', '2026-01-01', '2099-01-01', 'approved', '{"en":"…"}') RETURNING id`);
    await db.execute(sql`INSERT INTO research.research_consent (patient_id, protocol_id, given_by_kind,
      hipaa_authorization_ref, recording_permission, scope_speech_task, scope_trial_matching, scope_pgx_research,
      method, locale) VALUES (${p!.id}, ${rows[0]!.id}, 'patient', 'H', true, true, false, false, 'e_sign', 'en')`);
    const [c] = await db
      .insert(schema.call)
      .values({ patientId: p!.id, channel: 'voice', locale: 'en', scriptVersion: 'daily-call.v3' })
      .returning();
    return c!.id;
  };
  const post2 = (path: string, params: Record<string, string>) =>
    audioApp.inject({
      method: 'POST',
      url: path,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': twilioSignature(TOKEN, `${PUBLIC}${path}`, params),
      },
      payload: new URLSearchParams(params).toString(),
    });
  const runTask = async (id: string, said = 'Yesterday I went to the market and bought mangoes') => {
    await post2(`/api/voice/twilio/${id}/answer`, { CallSid: CALL, AnsweredBy: 'human' });
    await post2(`/api/voice/twilio/${id}/turn`, { CallSid: CALL, SpeechResult: "I'm fine" });
    const offer = await post2(`/api/voice/twilio/${id}/turn`, { CallSid: CALL, SpeechResult: 'yes' });
    expect(offer.body).toContain('for the research study you joined');
    return post2(`/api/voice/twilio/${id}/turn`, { CallSid: CALL, SpeechResult: said });
  };
  const audioJobs = async () =>
    (await queue.getJobs(['waiting', 'delayed'])).filter((j) => j.name === 'research.audio');

  beforeAll(async () => {
    audioApp = await buildServer({
      config: {
        allowedOrigins: [ORIGIN],
        docs: false,
        twilio: { authToken: TOKEN, publicApiOrigin: PUBLIC, speechAudio: true },
      },
      llm: new MockLLM(),
      telephony: tel,
    });
    for (const j of await audioJobs()) await j.remove(); // the queue is shared across runs
  });
  afterAll(async () => {
    await audioApp.close();
    await queue.close();
  });

  it('records only the speech task, then queues the audio for the research bucket', async () => {
    calls.length = 0;
    const end = await runTask(await consentedCall(true));
    expect(end.body).toContain('<Hangup/>');
    expect(calls).toEqual([`start ${CALL}`, `stop ${CALL}`]);
    const [job] = await audioJobs();
    expect(job!.data).toEqual({ sampleId: expect.any(String), recordingRef: REC });
    await job!.remove();
  });

  it('an emergency said during the task is still heard; the audio is deleted, not kept', async () => {
    calls.length = 0;
    const end = await runTask(await consentedCall(true), 'I have chest pain');
    expect(end.body).toContain('call 911 now');
    expect(calls).toEqual([`start ${CALL}`, `stop ${CALL}`, `delete ${REC}`]);
    expect(await audioJobs()).toHaveLength(0);
  });

  it('a hang-up during the task deletes what was recorded', async () => {
    const id = await consentedCall(true);
    await post2(`/api/voice/twilio/${id}/answer`, { CallSid: CALL, AnsweredBy: 'human' });
    await post2(`/api/voice/twilio/${id}/turn`, { CallSid: CALL, SpeechResult: "I'm fine" });
    await post2(`/api/voice/twilio/${id}/turn`, { CallSid: CALL, SpeechResult: 'yes' });
    calls.length = 0;
    await post2(`/api/voice/twilio/${id}/status`, { CallSid: CALL, CallStatus: 'completed' });
    expect(calls).toEqual([`delete all ${CALL}`]);
  });

  it('no recording without recording consent; a Twilio failure never breaks the call', async () => {
    calls.length = 0;
    await runTask(await consentedCall(false));
    expect(calls).toEqual([]);
    fail = true;
    const end = await runTask(await consentedCall(true));
    fail = false;
    expect(end.statusCode).toBe(200);
    expect(end.body).toContain('<Hangup/>');
  });
});
