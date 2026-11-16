/**
 * Telephony behind one interface (rule 0.3): `TwilioTelephony` places real calls and texts;
 * `MockTelephony` dials nothing and says so in its result. Real calls reach real people, so the
 * Twilio adapter refuses to start unless real data is enabled (SECURITY S17).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface Telephony {
  readonly mode: 'mock' | 'twilio';
  placeCall(o: {
    to: string;
    answerUrl: string;
    statusUrl: string;
  }): Promise<{ ref: string; dialed: boolean }>;
  sendSms(o: { to: string; body: string }): Promise<{ ref: string; sent: boolean }>;
  /** Voice Lab (D-032): the caller's side only, while speech recognition keeps running. */
  startRecording(callRef: string): Promise<{ ref: string }>;
  /** Stops the call's current recording and returns its id. */
  stopRecording(callRef: string): Promise<{ ref: string }>;
  /** 16-bit PCM WAV. */
  fetchRecording(recordingRef: string): Promise<Buffer>;
  /** Removes the vendor's copy once ours is stored. */
  deleteRecording(recordingRef: string): Promise<void>;
  /** Removes every recording left on a call (a hang-up mid-task). Returns how many. */
  deleteCallRecordings(callRef: string): Promise<number>;
}

const NO_AUDIO = () => Promise.reject(new Error('the mock telephony records no audio'));

export class MockTelephony implements Telephony {
  readonly mode = 'mock' as const;
  async placeCall() {
    return { ref: 'mock-not-dialed', dialed: false };
  }
  async sendSms() {
    return { ref: 'mock-not-sent', sent: false };
  }
  startRecording = NO_AUDIO;
  stopRecording = NO_AUDIO;
  fetchRecording = NO_AUDIO;
  deleteRecording = NO_AUDIO;
  deleteCallRecordings = NO_AUDIO;
}

const SID = /^(CA|RE)[0-9a-f]{32}$/;
const sid = (s: string) => {
  if (!SID.test(s)) throw new Error('twilio: bad sid');
  return s;
};

const e164 = (us: string) => {
  const d = us.replace(/\D/g, '');
  return d.length === 10 ? `+1${d}` : `+${d}`;
};

export class TwilioTelephony implements Telephony {
  readonly mode = 'twilio' as const;
  constructor(
    private readonly cfg: { accountSid: string; authToken: string; from: string; realDataEnabled: boolean },
    private readonly http: typeof fetch = fetch,
  ) {
    if (!cfg.realDataEnabled)
      throw new Error('Twilio calls real people: requires TOMONI_REAL_DATA_ENABLED=true');
  }

  private async req(method: 'GET' | 'POST' | 'DELETE', path: string, form?: Record<string, string>) {
    const res = await this.http(`https://api.twilio.com/2010-04-01/Accounts/${this.cfg.accountSid}/${path}`, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64')}`,
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(form ? { body: new URLSearchParams(form) } : {}),
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`twilio ${method} ${path.split('/')[0]}: HTTP ${res.status}`);
    return res;
  }
  private async post(path: string, form: Record<string, string>) {
    return (await (await this.req('POST', path, form)).json()) as { sid: string };
  }

  async startRecording(callRef: string) {
    const r = await this.post(`Calls/${sid(callRef)}/Recordings.json`, {
      RecordingTrack: 'inbound', // what Twilio hears from the patient, never Tomoni's own voice
      RecordingChannels: 'mono',
    });
    return { ref: sid(r.sid) };
  }
  async stopRecording(callRef: string) {
    const r = await this.post(`Calls/${sid(callRef)}/Recordings/Twilio.CURRENT.json`, { Status: 'stopped' });
    return { ref: sid(r.sid) };
  }
  async fetchRecording(recordingRef: string) {
    return Buffer.from(await (await this.req('GET', `Recordings/${sid(recordingRef)}.wav`)).arrayBuffer());
  }
  async deleteRecording(recordingRef: string) {
    await this.req('DELETE', `Recordings/${sid(recordingRef)}.json`);
  }
  async deleteCallRecordings(callRef: string) {
    const r = await this.req('GET', `Calls/${sid(callRef)}/Recordings.json`);
    const { recordings = [] } = (await r.json()) as { recordings?: { sid: string }[] };
    for (const x of recordings) await this.deleteRecording(x.sid);
    return recordings.length;
  }

  async placeCall(o: { to: string; answerUrl: string; statusUrl: string }) {
    const r = await this.post('Calls.json', {
      To: e164(o.to),
      From: this.cfg.from,
      Url: o.answerUrl,
      StatusCallback: o.statusUrl,
      MachineDetection: 'Enable',
    });
    return { ref: r.sid, dialed: true };
  }

  async sendSms(o: { to: string; body: string }) {
    const r = await this.post('Messages.json', { To: e164(o.to), From: this.cfg.from, Body: o.body });
    return { ref: r.sid, sent: true };
  }
}

/**
 * Twilio request signature: base64 HMAC-SHA1 over the full URL followed by every POST parameter
 * (sorted by name) as name+value, keyed with the auth token.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(data).digest('base64');
}

export function verifyTwilio(
  authToken: string,
  url: string,
  params: Record<string, string>,
  header: string | undefined,
) {
  if (!header) return false;
  const want = Buffer.from(twilioSignature(authToken, url, params));
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function telephonyFromEnv(env: NodeJS.ProcessEnv = process.env): Telephony {
  if (env.TOMONI_ADAPTER_TELEPHONY !== 'real') return new MockTelephony();
  const {
    TOMONI_TWILIO_ACCOUNT_SID: accountSid,
    TOMONI_TWILIO_AUTH_TOKEN: authToken,
    TOMONI_TWILIO_FROM: from,
  } = env;
  if (!accountSid || !authToken || !from)
    throw new Error('TOMONI_TWILIO_ACCOUNT_SID, _AUTH_TOKEN and _FROM are required');
  return new TwilioTelephony({
    accountSid,
    authToken,
    from,
    realDataEnabled: env.TOMONI_REAL_DATA_ENABLED === 'true',
  });
}
