import { describe, expect, it } from 'vitest';
import { mapEob, MockBlueButton, pkce, RealBlueButton, synthBundle, eobsFromBundles } from '../src';

/** Shaped like a Blue Button 2.0 sandbox PDE EOB (CARIN BB), including fields Tomoni ignores. */
const sandboxPde = {
  resourceType: 'ExplanationOfBenefit',
  id: 'pde--1000006417',
  meta: {
    lastUpdated: '2026-10-20T05:07:01.000-04:00',
    profile: ['http://hl7.org/fhir/us/carin-bb/StructureDefinition/C4BB-ExplanationOfBenefit-Pharmacy'],
  },
  extension: [
    { url: 'https://bluebutton.cms.gov/resources/variables/dspnsng_stus_cd', valueCoding: { code: 'P' } },
  ],
  type: {
    coding: [
      { system: 'https://bluebutton.cms.gov/resources/codesystem/eob-type', code: 'PDE' },
      { system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: 'pharmacy' },
    ],
  },
  patient: { reference: 'Patient/-10000010254618' },
  billablePeriod: { start: '2026-10-18', end: '2026-10-18' },
  facility: { identifier: { system: 'http://hl7.org/fhir/sid/us-npi', value: '1023011079' } },
  supportingInfo: [
    { sequence: 1, category: { coding: [{ code: 'compoundcode' }] }, code: { coding: [{ code: '1' }] } },
    { sequence: 2, category: { coding: [{ code: 'refillnum' }] }, valueQuantity: { value: 3 } },
    { sequence: 3, category: { coding: [{ code: 'dayssupply' }] }, valueQuantity: { value: 30 } },
  ],
  item: [
    {
      sequence: 1,
      productOrService: {
        coding: [{ system: 'http://hl7.org/fhir/sid/ndc', code: '00093505601', display: 'CLOPIDOGREL' }],
      },
      servicedDate: '2026-10-18',
      quantity: { value: 30 },
      adjudication: [
        {
          category: { coding: [{ code: 'https://bluebutton.cms.gov/resources/variables/ptnt_pay_amt' }] },
          amount: { value: 4.15 },
        },
      ],
    },
  ],
};

describe('mapEob', () => {
  it('maps a sandbox-shaped PDE to a fill, without inventing refills it does not carry', () => {
    expect(mapEob(sandboxPde)).toEqual({
      kind: 'fill',
      sourceRef: 'pde--1000006417',
      ndc: '00093505601',
      name: 'CLOPIDOGREL',
      fillDate: '2026-10-18',
      daysSupply: 30,
      quantity: 30,
      fillNumber: 3,
      refillsAuthorized: null,
      pharmacyNpi: '1023011079',
      patientPaidCents: 415,
    });
  });

  it('drops EOBs missing what a fill needs, and EOB types Tomoni does not use', () => {
    const noNdc = { ...sandboxPde, item: [{ ...sandboxPde.item[0], productOrService: { coding: [] } }] };
    expect(mapEob(noNdc)).toBeNull();
    expect(mapEob({ ...sandboxPde, supportingInfo: [] })).toBeNull(); // no days supply
    expect(mapEob({ ...sandboxPde, id: 'bad id; DROP' })).toBeNull();
    expect(
      mapEob({
        ...sandboxPde,
        type: {
          coding: [{ system: 'https://bluebutton.cms.gov/resources/codesystem/eob-type', code: 'DME' }],
        },
      }),
    ).toBeNull();
    expect(mapEob({ resourceType: 'Patient' })).toBeNull();
  });

  it('maps a carrier claim with its diagnosis codes', () => {
    const carrier = {
      resourceType: 'ExplanationOfBenefit',
      id: 'carrier-1',
      type: {
        coding: [{ system: 'https://bluebutton.cms.gov/resources/codesystem/eob-type', code: 'CARRIER' }],
      },
      billablePeriod: { start: '2026-09-02', end: '2026-09-02' },
      diagnosis: [{ diagnosisCodeableConcept: { coding: [{ code: 'E11.9' }, { code: '<script>' }] } }],
    };
    expect(mapEob(carrier)).toEqual({
      kind: 'claim',
      sourceRef: 'carrier-1',
      claimKind: 'carrier',
      startDate: '2026-09-02',
      endDate: '2026-09-02',
      dxCodes: ['E11.9'],
    });
  });
});

describe('synthetic EOBs', () => {
  const drugs = [{ ndc: '99000000701', rxcui: '309362', name: 'clopidogrel 75 MG Oral Tablet' }];
  const inp = { beneficiaryId: 'mock-abc', refDate: '2026-11-15', drugs, pharmacyNpis: ['0999000001'] };
  const scenario = { meds: [{ rxcui: '309362', lastFillDaysAgo: 21, refillsLeft: 0 }] };

  it('are deterministic and go through the same mapper as real data', () => {
    expect(synthBundle({ ...inp, scenario })).toEqual(synthBundle({ ...inp, scenario }));
    const fills = eobsFromBundles([synthBundle({ ...inp, scenario })])
      .map(mapEob)
      .filter((m) => m?.kind === 'fill');
    expect(fills.length).toBeGreaterThan(4);
    expect(fills[0]).toMatchObject({
      fillDate: '2026-10-25',
      daysSupply: 30,
      fillNumber: 11,
      refillsAuthorized: 11,
    });
  });

  it('the mock skips Medicare.gov and needs a synthetic beneficiary id', async () => {
    const mock = new MockBlueButton({ drugs, pharmacyNpis: ['0999000001'], scenarios: new Map() });
    expect(
      mock.authorizeUrl({ state: 's1', redirectUri: 'http://localhost:3000/api/bluebutton/callback' }),
    ).toBe('http://localhost:3000/api/bluebutton/callback?code=mock&state=s1');
    await expect(mock.exchange({})).rejects.toThrow(/synthetic MBI/);
  });
});

describe('RealBlueButton (sandbox)', () => {
  const cfg = { clientId: 'cid', clientSecret: 'secret' };

  it('uses OAuth2 with PKCE S256 against the sandbox host', () => {
    const { verifier, challenge } = pkce();
    expect(verifier).not.toBe(challenge);
    const u = new URL(
      new RealBlueButton(cfg).authorizeUrl({
        state: 'st',
        codeChallenge: challenge,
        redirectUri: 'https://x/cb',
      }),
    );
    expect(u.origin).toBe('https://sandbox.bluebutton.cms.gov');
    expect(u.pathname).toBe('/v2/o/authorize/');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'cid',
      state: 'st',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
  });

  it('refuses production while real data is off (SECURITY S17)', () => {
    expect(() => new RealBlueButton({ ...cfg, production: true })).toThrow(/TOMONI_REAL_DATA_ENABLED/);
  });

  it('exchanges a code and pages through EOBs, but never follows a link off the CMS host', async () => {
    const calls: string[] = [];
    const http = (async (url: URL | string, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).endsWith('/v2/o/token/')) {
        expect(String(init?.body)).toContain('code_verifier=v1');
        return Response.json({
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 3600,
          scope: 's',
          patient: '-10000010254618',
        });
      }
      const page = calls.length;
      return Response.json({
        resourceType: 'Bundle',
        entry: [],
        link: [
          {
            relation: 'next',
            url:
              page === 2
                ? 'https://sandbox.bluebutton.cms.gov/v2/fhir/ExplanationOfBenefit/?page=2'
                : 'https://evil.example/steal',
          },
        ],
      });
    }) as typeof fetch;
    const bb = new RealBlueButton(cfg, http);
    const t = await bb.exchange({ code: 'c1', codeVerifier: 'v1', redirectUri: 'https://x/cb' });
    expect(t).toMatchObject({ fhirPatientId: '-10000010254618', accessToken: 'at', refreshToken: 'rt' });
    await expect(bb.fetchBundles(t)).rejects.toThrow(/left the CMS host/);
    expect(calls.filter((c) => c.includes('evil'))).toEqual([]);
  });
});
