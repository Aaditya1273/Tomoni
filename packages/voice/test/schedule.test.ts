import { describe, expect, it } from 'vitest';
import {
  callKey,
  isDue,
  localClock,
  MockTelephony,
  TwilioTelephony,
  twilioSignature,
  verifyTwilio,
  type Candidate,
} from '../src';

const raj: Candidate = {
  patientId: 'p1',
  tz: 'America/New_York',
  windowStart: '10:00:00',
  windowEnd: '12:00:00',
  quietStart: '20:00',
  quietEnd: '09:00',
};

describe('scheduler (rule 2.10)', () => {
  it('uses the patient’s own clock, across time zones and DST', () => {
    expect(localClock(new Date('2026-11-15T15:30:00Z'), 'America/New_York')).toEqual({
      date: '2026-11-15',
      minute: 630,
    });
    expect(localClock(new Date('2026-07-15T15:30:00Z'), 'America/New_York').minute).toBe(690); // EDT
    expect(localClock(new Date('2026-11-16T03:30:00Z'), 'America/Chicago').date).toBe('2026-11-15');
  });

  it('is due inside the call window and not before or after it', () => {
    expect(isDue(raj, new Date('2026-11-15T15:30:00Z')).due).toBe(true); // 10:30 New York
    expect(isDue(raj, new Date('2026-11-15T14:59:00Z')).due).toBe(false); // 09:59
    expect(isDue(raj, new Date('2026-11-15T17:00:00Z')).due).toBe(false); // 12:00
    expect(isDue({ ...raj, tz: 'America/Chicago' }, new Date('2026-11-15T15:30:00Z')).due).toBe(false); // 09:30 Chicago
  });

  it('quiet hours win over the call window, including windows that wrap midnight', () => {
    const late = { ...raj, windowStart: '19:00', windowEnd: '23:00' };
    expect(isDue(late, new Date('2026-11-16T00:30:00Z')).due).toBe(true); // 19:30 New York
    expect(isDue(late, new Date('2026-11-16T01:30:00Z')).due).toBe(false); // 20:30, quiet
    expect(
      isDue({ ...raj, quietStart: '10:00', quietEnd: '11:00' }, new Date('2026-11-15T15:30:00Z')).due,
    ).toBe(false);
  });

  it('one call key per patient per local day', () => {
    expect(callKey('p1', '2026-11-15')).toBe('daily:p1:2026-11-15');
  });
});

describe('telephony', () => {
  it('the mock dials nothing and says so', async () => {
    expect(await new MockTelephony().placeCall()).toEqual({ ref: 'mock-not-dialed', dialed: false });
  });

  it('Twilio refuses to start while real data is off', () => {
    expect(
      () =>
        new TwilioTelephony({
          accountSid: 'AC1',
          authToken: 't',
          from: '+15550000000',
          realDataEnabled: false,
        }),
    ).toThrow(/TOMONI_REAL_DATA_ENABLED/);
  });

  it('verifies Twilio signatures and rejects tampering', () => {
    // Twilio's documented example (Security: validating requests).
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    const params = {
      CallSid: 'CA1234567890ABCDE',
      Caller: '+14158675309',
      Digits: '1234',
      From: '+14158675309',
      To: '+18005551212',
    };
    const sig = twilioSignature('12345', url, params);
    expect(sig).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=');
    expect(verifyTwilio('12345', url, params, sig)).toBe(true);
    expect(verifyTwilio('12345', url, { ...params, Digits: '9999' }, sig)).toBe(false);
    expect(verifyTwilio('12345', url, params, undefined)).toBe(false);
  });
});
