import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import { systemScope } from '@tomoni/core';
import { closePools, env, hashFor, ownerDb, schema, withScope } from '@tomoni/db';
import {
  ingestBundles,
  KOKILA_MBI,
  loadSamples,
  MockBlueButton,
  mockBeneficiaryId,
  RAJ_MBI,
  runEngine,
  sampleDrugs,
  samplePharmacyNpis,
  scriptedScenarios,
} from '@tomoni/medicines';
import { Client, makePracticeAndHousehold, makeUser, testServer, totp } from './helpers';

const TODAY = '2026-11-15';
const mock = new MockBlueButton({
  drugs: sampleDrugs(),
  pharmacyNpis: samplePharmacyNpis(),
  scenarios: scriptedScenarios(),
});
let s: Awaited<ReturnType<typeof testServer>>;
let raj = '';
let kokila = '';
let other = '';
let practiceId = '';
let asha: Client;
let stranger: Client;
const redis = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue('tomoni', { connection: redis, prefix: 'test-api' });

async function patient(householdId: string, practiceId: string, name: string, mbi: string) {
  const [p] = await ownerDb()
    .insert(schema.patient)
    .values({
      practiceId,
      householdId,
      mbi,
      mbiHash: hashFor.mbi(mbi),
      name,
      dob: '1953-04-02',
      birthYear: 1953,
      state: 'NJ',
      locale: 'gu',
      tz: 'America/New_York',
      medicareType: 'original',
    })
    .returning();
  for (const year of [2026, 2027])
    await ownerDb()
      .insert(schema.patientPlan)
      .values({ patientId: p!.id, year, contractId: 'S9901', planId: '001', segmentId: '0' });
  return p!.id;
}

beforeAll(async () => {
  s = await testServer();
  await queue.obliterate({ force: true });
  const db = ownerDb();
  await loadSamples(db, 'test');
  const ids = await makePracticeAndHousehold();
  practiceId = ids.practiceId;
  const otherIds = await makePracticeAndHousehold();
  raj = await patient(ids.householdId, ids.practiceId, 'Raj Patel', RAJ_MBI);
  kokila = await patient(ids.householdId, ids.practiceId, 'Kokila Patel', KOKILA_MBI);
  other = await patient(otherIds.householdId, otherIds.practiceId, 'Lata Iyer', '0TM99999999');
  for (const [id, mbi] of [
    [raj, RAJ_MBI],
    [other, '0TM99999999'],
  ] as const) {
    const t = await mock.exchange({ mockBeneficiaryId: mockBeneficiaryId(mbi) });
    await ingestBundles(db, id, await mock.fetchBundles(t, TODAY), 'mock');
  }
  await withScope('worker', systemScope('test'), (w) => runEngine(w, { today: TODAY }));

  asha = new Client(s.app);
  await asha.login((await makeUser('family_member', { householdId: ids.householdId })).email);
  stranger = new Client(s.app);
  await stranger.login((await makeUser('family_member', { householdId: otherIds.householdId })).email);
});
afterAll(async () => {
  await queue.close();
  redis.disconnect();
  await s.app.close();
  await closePools();
});

describe('family card', () => {
  it('shows the household, every medicine with its Access Score, and sourced warnings', async () => {
    const res = await asha.req('GET', '/api/family/card');
    expect(res.statusCode).toBe(200);
    const card = res.json();
    expect(card.asOf).toBe(TODAY);
    expect(card.patients.map((p: { name: string }) => p.name)).toEqual(['Raj Patel', 'Kokila Patel']);
    const r = card.patients[0];
    expect(r.access).toBe('red');
    expect(r.medicare).toBeNull(); // not connected through the app yet
    expect(r.medicines).toHaveLength(5);
    expect(r.medicines.find((m: { name: string }) => m.name.startsWith('clopidogrel')).access).toBe('red');
    expect(r.medicines.find((m: { name: string }) => m.name.startsWith('amlodipine')).access).toBe('green');
    expect(r.warnings.map((w: { type: string }) => w.type)).toEqual([
      'run_out',
      'premium_jump',
      'tier_change',
    ]);
    expect(r.warnings[0]).toMatchObject({
      access: 'red',
      daysUntilProblem: 9,
      drug: 'clopidogrel 75 MG Oral Tablet',
      source: { kind: 'fill', label: 'claims:mock' },
      facts: { refillsRemaining: 0, runOutDate: '2026-11-24' },
    });
    expect(r.warnings[1]).toMatchObject({
      source: {
        kind: 'data_file',
        date: '2027-01-01',
        label: 'Synthetic sample in CMS Part D file format, 2027',
      },
      facts: { premiumBeforeCents: 3800, premiumAfterCents: 6100, plan: 'Sample Basic PDP' },
    });
    // No claims yet, but her plan's premium still rises: plan warnings don't need fills.
    expect(card.patients[1]).toMatchObject({ name: 'Kokila Patel', medicines: [], medicare: null });
    expect(card.patients[1].warnings.map((w: { type: string }) => w.type)).toEqual(['premium_jump']);
  });

  it('never shows another household, and staff get no family card', async () => {
    const card = (await stranger.req('GET', '/api/family/card')).json();
    expect(card.patients.map((p: { name: string }) => p.name)).toEqual(['Lata Iyer']);
    const nurse = new Client(s.app);
    await nurse.login((await makeUser('nurse', { practiceId })).email);
    expect((await nurse.req('GET', '/api/family/card')).statusCode).toBe(403);
    expect((await new Client(s.app).req('GET', '/api/family/card')).statusCode).toBe(401);
  });

  it('audits each card read per patient', async () => {
    const { rows } = await ownerDb().execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM audit.event WHERE entity_type = 'family_card' AND patient_id = ${raj}`,
    );
    expect(rows[0]!.n).toBeGreaterThan(0);
  });
});

describe('evidence', () => {
  const warningsOf = async (c: Client) =>
    (await c.req('GET', '/api/family/card')).json().patients[0].warnings as { id: string; type: string }[];

  it('a fill warning shows the claim it came from', async () => {
    const w = (await warningsOf(asha))[0]!;
    const res = await asha.req('GET', `/api/warnings/${w.id}`);
    expect(res.statusCode).toBe(200);
    const ev = res.json();
    expect(ev.warning).toMatchObject({ type: 'run_out', patientName: 'Raj Patel', status: 'open' });
    expect(ev.fills).toHaveLength(1);
    expect(ev.fills[0]).toMatchObject({
      fillDate: '2026-10-25',
      daysSupply: 30,
      source: 'mock',
      pharmacy: expect.any(String),
    });
    expect(ev.files).toEqual([]);
  });

  it('a file warning shows both file versions with their hashes', async () => {
    const w = (await warningsOf(asha)).find((x) => x.type === 'tier_change')!;
    const ev = (await asha.req('GET', `/api/warnings/${w.id}`)).json();
    expect(ev.files.map((f: { role: string; effectiveDate: string }) => [f.role, f.effectiveDate])).toEqual([
      ['after', '2027-01-01'],
      ['before', '2026-01-01'],
    ]);
    expect(ev.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('another household gets 404, not the evidence', async () => {
    const w = (await warningsOf(asha))[0]!;
    expect((await stranger.req('GET', `/api/warnings/${w.id}`)).statusCode).toBe(404);
  });
});

describe('Blue Button connect (mock)', () => {
  it('connect → callback stores the link, audits it and queues a sync; the state is single-use', async () => {
    const res = await asha.req('POST', `/api/patients/${kokila}/bluebutton/connect`);
    expect(res.statusCode).toBe(200);
    const { authorizeUrl, mode } = res.json();
    expect(mode).toBe('mock');
    const u = new URL(authorizeUrl);
    expect(u.pathname).toBe('/api/bluebutton/callback');
    // CMS comes back cross-site: no session cookie, the state alone identifies the request.
    const cb = await new Client(s.app).req('GET', `${u.pathname}${u.search}`);
    expect(cb.statusCode).toBe(303);
    expect(cb.headers.location).toBe('/family?medicare=connected');
    const [link] = await ownerDb()
      .select()
      .from(schema.bluebuttonLink)
      .where(sql`patient_id = ${kokila}`);
    expect(link).toMatchObject({ mode: 'mock', fhirPatientId: mockBeneficiaryId(KOKILA_MBI) });
    const jobs = await queue.getJobs(['waiting', 'delayed']);
    expect(jobs.map((j) => [j.name, j.data])).toContainEqual(['bluebutton.sync', { patientId: kokila }]);
    const replay = await new Client(s.app).req('GET', `${u.pathname}${u.search}`);
    expect(replay.headers.location).toBe('/family?medicare=expired');
  });

  it('cannot start a connection for another household’s patient', async () => {
    expect((await stranger.req('POST', `/api/patients/${raj}/bluebutton/connect`)).statusCode).toBe(404);
  });

  it('a forged state goes nowhere', async () => {
    const r = await new Client(s.app).req('GET', '/api/bluebutton/callback?code=mock&state=forged');
    expect(r.headers.location).toBe('/family?medicare=expired');
  });
});

describe('admin PBM upload', () => {
  const csv =
    'Formulary,RXCUI,Action,Tier,Effective\n00090001,309362,Removed,,2026-12-01\n00090001,x,Removed,,2026-12-01\n';
  const mapping = {
    formularyId: 'Formulary',
    drug: { column: 'RXCUI', kind: 'rxcui' },
    change: 'Action',
    newTier: 'Tier',
    effectiveDate: 'Effective',
  };
  let admin: Client;

  beforeAll(async () => {
    admin = new Client(s.app);
    await admin.login((await makeUser('admin')).email);
    const { secret } = (await admin.req('POST', '/api/auth/mfa/enroll')).json();
    expect(
      (await admin.req('POST', '/api/auth/mfa/enroll/confirm', { code: await totp(secret) })).statusCode,
    ).toBe(204);
  });

  it('is admin-only', async () => {
    expect((await asha.req('POST', '/api/admin/pbm/preview', { csv })).statusCode).toBe(403);
  });

  it('previews headers, then saves mapped rows with drop reasons and queues the engine', async () => {
    const pre = (await admin.req('POST', '/api/admin/pbm/preview', { csv })).json();
    expect(pre).toMatchObject({
      headers: ['Formulary', 'RXCUI', 'Action', 'Tier', 'Effective'],
      rowCount: 2,
    });
    const res = await admin.req('POST', '/api/admin/pbm', { csv, label: 'Demo PBM', mapping });
    expect(res.json()).toMatchObject({
      saved: 1,
      duplicate: false,
      droppedCount: 1,
      dropped: [{ line: 3, reason: 'rxcui' }],
    });
    const jobs = await queue.getJobs(['waiting', 'delayed']);
    expect(jobs.some((j) => j.name === 'engine.run')).toBe(true);
    expect(
      (await admin.req('POST', '/api/admin/pbm', { csv, label: 'Demo PBM', mapping })).json().duplicate,
    ).toBe(true);
    const files = (await admin.req('GET', '/api/admin/data-files')).json();
    expect(files[0]).toMatchObject({ kind: 'pbm_changes', label: 'Demo PBM', rowCount: 1, droppedCount: 1 });
  });

  it('a mapping that names a missing column is a 400 with the column named', async () => {
    const res = await admin.req('POST', '/api/admin/pbm', {
      csv,
      label: 'x',
      mapping: { ...mapping, change: 'Nope' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('change');
  });
});
