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
}

export class MockTelephony implements Telephony {
  readonly mode = 'mock' as const;
  async placeCall() {
    return { ref: 'mock-not-dialed', dialed: false };
  }
  async sendSms() {
    return { ref: 'mock-not-sent', sent: false };
  }
}

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

  private async post(path: string, form: Record<string, string>) {
    const res = await this.http(`https://api.twilio.com/2010-04-01/Accounts/${this.cfg.accountSid}/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`twilio ${path}: HTTP ${res.status}`);
    return (await res.json()) as { sid: string };
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
