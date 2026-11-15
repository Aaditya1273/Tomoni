import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { systemScope } from '@tomoni/core';
import { closePools, ownerDb, repoRoot, schema, withScope } from '@tomoni/db';
import { runEngine } from '@tomoni/medicines';
import { buildServer } from '../src/server';
import { Client, makeUser, ORIGIN } from './helpers';

let app: Awaited<ReturnType<typeof buildServer>>;
let sunita = '';
let usPatient = '';
let priya: Client;
// 1×1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(async () => {
  app = await buildServer({ config: { allowedOrigins: [ORIGIN], docs: false } });
  const db = ownerDb();
  const [team] = await db
    .insert(schema.practice)
    .values({ name: 'Tomoni India Care Team', tz: 'Asia/Kolkata' })
    .returning();
  const [h] = await db
    .insert(schema.household)
    .values({ displayName: 'Mehta', primaryLocale: 'gu', region: 'IN' })
    .returning();
  const [us] = await db
    .insert(schema.household)
    .values({ displayName: 'Shah', primaryLocale: 'gu' })
    .returning();
  const mk = (householdId: string, name: string) => ({
    practiceId: team!.id,
    householdId,
    name,
    dob: '1952-03-03',
    birthYear: 1952,
    state: 'GJ',
    locale: 'gu',
    tz: 'Asia/Kolkata',
    medicareType: 'none' as const,
  });
  sunita = (await db.insert(schema.patient).values(mk(h!.id, 'Sunita Mehta')).returning())[0]!.id;
  usPatient = (await db.insert(schema.patient).values(mk(us!.id, 'Hari Shah')).returning())[0]!.id;
  priya = new Client(app);
  await priya.login((await makeUser('family_member', { householdId: h!.id })).email);
});
afterAll(async () => {
  await app.close();
  await closePools();
});

const entry = (o: Record<string, unknown> = {}) => ({
  name: 'Telmisartan 40 mg',
  dosesPerDay: 1,
  quantity: 30,
  filledOn: '2026-10-25',
  refillsLeft: 0,
  photo: PNG.toString('base64'),
  ...o,
});

describe('India bridge: family-entered medicines', () => {
  it('a family member adds a medicine with a photo; the engine warns before it runs out', async () => {
    const r = await priya.req('POST', `/api/family/patients/${sunita}/medicines`, entry());
    expect(r.statusCode, r.body).toBe(200);
    await withScope('worker', systemScope('test'), (w) =>
      runEngine(w, { today: '2026-11-15', patientIds: [sunita] }),
    );
    const card = (await priya.req('GET', '/api/family/card')).json();
    const p = card.patients[0];
    expect(p).toMatchObject({ name: 'Sunita Mehta', region: 'IN' });
    expect(p.medicines[0]).toMatchObject({
      name: 'Telmisartan 40 mg',
      runOutDate: '2026-11-24',
      access: 'red',
    });
    expect(p.warnings[0]).toMatchObject({
      type: 'run_out',
      daysUntilProblem: 9,
      source: { kind: 'fill', label: 'claims:family' },
    });

    const ev = (await priya.req('GET', `/api/warnings/${p.warnings[0].id}`)).json();
    expect(ev.fills[0]).toMatchObject({ hasPhoto: true, ndc: null, drug: 'Telmisartan 40 mg' });
    const photo = await priya.req('GET', `/api/fills/${ev.fills[0].id}/photo`);
    expect(photo.headers['content-type']).toBe('image/png');
    expect(Buffer.from(photo.rawPayload).equals(PNG)).toBe(true);
  });

  it('the photo is encrypted on disk', () => {
    const dir = path.join(repoRoot(), '.data', 'objects', 'rx', sunita);
    const file = path.join(dir, readdirSync(dir)[0]!);
    expect(readFileSync(file).includes(PNG.subarray(1, 8))).toBe(false);
    expect(statSync(file).mode & 0o077).toBe(0);
  });

  it('a second fill of the same medicine reuses it', async () => {
    await priya.req(
      'POST',
      `/api/family/patients/${sunita}/medicines`,
      entry({ name: 'telmisartan 40 MG', filledOn: '2026-11-14', refillsLeft: 2, photo: null }),
    );
    const meds = await ownerDb().select().from(schema.medication);
    expect(meds.filter((m) => m.patientId === sunita)).toHaveLength(1);
  });

  it('refuses what is not a photo, dates outside the last year, US households and other families', async () => {
    const bad = await priya.req(
      'POST',
      `/api/family/patients/${sunita}/medicines`,
      entry({ photo: Buffer.from('<svg onload=alert(1)>').toString('base64') }),
    );
    expect(bad.json().error).toBe('bad_photo');
    expect(
      (
        await priya.req('POST', `/api/family/patients/${sunita}/medicines`, entry({ filledOn: '2027-01-01' }))
      ).json().error,
    ).toBe('bad_date');
    expect(
      (await priya.req('POST', `/api/family/patients/${usPatient}/medicines`, entry({ photo: null })))
        .statusCode,
    ).toBe(403);
    // A US family has claims data, so it cannot enter medicines even for its own patient.
    const [us] = await ownerDb()
      .select()
      .from(schema.patient)
      .where(sql`id = ${usPatient}`);
    const shah = new Client(app);
    await shah.login((await makeUser('family_member', { householdId: us!.householdId })).email);
    expect(
      (await shah.req('POST', `/api/family/patients/${usPatient}/medicines`, entry({ photo: null })))
        .statusCode,
    ).toBe(403);
    const [fill] = await ownerDb().select().from(schema.fill);
    expect((await shah.req('GET', `/api/fills/${fill!.id}/photo`)).statusCode).toBe(404);
  });
});
