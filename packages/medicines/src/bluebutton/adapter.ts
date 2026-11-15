/**
 * Blue Button 2.0 behind one interface (BUILD_PROMPT rule 0.3): `RealBlueButton` talks OAuth2 +
 * PKCE to CMS (the sandbox by default) and `MockBlueButton` returns synthetic EOBs. Which one runs
 * is set by TOMONI_ADAPTER_BLUEBUTTON; the SANDBOX bar shows whenever the mock is active.
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { realDataEnabled } from '@tomoni/db';
import { synthBundle, type Scenario, type SynthDrug } from './synth';

export interface BlueButtonTokens {
  fhirPatientId: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string;
}

export interface BlueButton {
  readonly mode: 'sandbox' | 'production' | 'mock';
  authorizeUrl(o: { state: string; codeChallenge: string; redirectUri: string }): string;
  /** `mockBeneficiaryId` is only read by the mock, which has no Medicare.gov login to learn it from. */
  exchange(o: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    mockBeneficiaryId?: string;
  }): Promise<BlueButtonTokens>;
  refresh(t: BlueButtonTokens): Promise<BlueButtonTokens>;
  /** FHIR searchset Bundles of the beneficiary's EOBs. `asOf` is the date the data is current to. */
  fetchBundles(t: BlueButtonTokens, asOf: string): Promise<unknown[]>;
}

export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

const SANDBOX = 'https://sandbox.bluebutton.cms.gov';
const PRODUCTION = 'https://api.bluebutton.cms.gov';
const SCOPE = 'openid profile patient/ExplanationOfBenefit.read patient/Patient.read';
const MAX_PAGES = 40;

const TokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().default(''),
  patient: z.string().regex(/^-?[A-Za-z0-9.]{1,64}$/),
});

export class RealBlueButton implements BlueButton {
  readonly mode: 'sandbox' | 'production';
  private readonly base: string;

  constructor(
    private readonly cfg: { clientId: string; clientSecret: string; production?: boolean },
    private readonly http: typeof fetch = fetch,
  ) {
    // SECURITY S17: production beneficiary data only after legal sign-off.
    if (cfg.production && !realDataEnabled())
      throw new Error('Blue Button production requires TOMONI_REAL_DATA_ENABLED=true');
    this.mode = cfg.production ? 'production' : 'sandbox';
    this.base = cfg.production ? PRODUCTION : SANDBOX;
  }

  authorizeUrl(o: { state: string; codeChallenge: string; redirectUri: string }): string {
    const u = new URL('/v2/o/authorize/', this.base);
    u.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.cfg.clientId,
      redirect_uri: o.redirectUri,
      state: o.state,
      code_challenge: o.codeChallenge,
      code_challenge_method: 'S256',
      scope: SCOPE,
    }).toString();
    return u.toString();
  }

  private async token(form: Record<string, string>): Promise<BlueButtonTokens> {
    const res = await this.http(new URL('/v2/o/token/', this.base), {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`bluebutton token: HTTP ${res.status}`);
    const t = TokenResponse.parse(await res.json());
    return {
      fhirPatientId: t.patient,
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null,
      expiresAt: new Date(Date.now() + t.expires_in * 1000),
      scope: t.scope,
    };
  }

  exchange(o: { code: string; codeVerifier: string; redirectUri: string }) {
    return this.token({
      grant_type: 'authorization_code',
      code: o.code,
      redirect_uri: o.redirectUri,
      code_verifier: o.codeVerifier,
    });
  }

  async refresh(t: BlueButtonTokens) {
    if (!t.refreshToken) throw new Error('bluebutton: no refresh token; the family must reconnect');
    const next = await this.token({ grant_type: 'refresh_token', refresh_token: t.refreshToken });
    return { ...next, fhirPatientId: t.fhirPatientId };
  }

  async fetchBundles(t: BlueButtonTokens): Promise<unknown[]> {
    if (!t.accessToken) throw new Error('bluebutton: not connected');
    const bundles: unknown[] = [];
    let url: URL | null = new URL('/v2/fhir/ExplanationOfBenefit/', this.base);
    url.search = new URLSearchParams({ patient: t.fhirPatientId, _count: '50' }).toString();
    for (let page = 0; url && page < MAX_PAGES; page++) {
      // Follow `next` links only on the CMS host: the agent never makes free-form calls (rule 2.2).
      if (url.origin !== this.base) throw new Error('bluebutton: next link left the CMS host');
      const res: Response = await this.http(url, {
        headers: { authorization: `Bearer ${t.accessToken}`, accept: 'application/fhir+json' },
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      });
      if (!res.ok) throw new Error(`bluebutton EOB: HTTP ${res.status}`);
      const b = (await res.json()) as { link?: { relation: string; url: string }[] };
      bundles.push(b);
      const next = b.link?.find((l) => l.relation === 'next')?.url;
      url = next ? new URL(next) : null;
    }
    return bundles;
  }
}

export class MockBlueButton implements BlueButton {
  readonly mode = 'mock' as const;
  constructor(
    private readonly data: { drugs: SynthDrug[]; pharmacyNpis: string[]; scenarios: Map<string, Scenario> },
  ) {}

  /** No Medicare.gov round trip: straight back to our callback, which the UI labels SANDBOX. */
  authorizeUrl(o: { state: string; redirectUri: string }): string {
    const u = new URL(o.redirectUri);
    u.searchParams.set('code', 'mock');
    u.searchParams.set('state', o.state);
    return u.toString();
  }

  async exchange(o: { mockBeneficiaryId?: string }): Promise<BlueButtonTokens> {
    if (!o.mockBeneficiaryId) throw new Error('mock bluebutton: patient has no synthetic MBI');
    return {
      fhirPatientId: o.mockBeneficiaryId,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      scope: 'mock',
    };
  }

  async refresh(t: BlueButtonTokens) {
    return t;
  }

  async fetchBundles(t: BlueButtonTokens, asOf: string): Promise<unknown[]> {
    const scenario = this.data.scenarios.get(t.fhirPatientId);
    return [
      synthBundle({
        beneficiaryId: t.fhirPatientId,
        refDate: asOf,
        drugs: this.data.drugs,
        pharmacyNpis: this.data.pharmacyNpis,
        ...(scenario ? { scenario } : {}),
      }),
    ];
  }
}
