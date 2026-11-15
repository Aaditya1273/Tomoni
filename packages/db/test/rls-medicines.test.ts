import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonymousScope } from '@tomoni/core';
import { closePools, ownerDb, schema, withScope } from '../src';
import { buildWorld, pgError } from './fixtures';

let w: Awaited<ReturnType<typeof buildWorld>>;

const warningFor = (patientId: string, key: string) => ({
  patientId,
  type: 'late_refill' as const,
  daysUntilProblem: 0,
  problemDate: '2026-11-15',
  accessStatus: 'red' as const,
  sourceKind: 'fill' as const,
  sourceRef: key,
  sourceDate: '2026-10-10',
  evidence: {},
  dedupeKey: key,
});

beforeAll(async () => {
  w = await buildWorld();
  const db = ownerDb();
  await db.delete(schema.dataFileVersion);
  for (const p of [w.raj, w.lata]) {
    const [m] = await db
      .insert(schema.medication)
      .values({ patientId: p.id, rxcui: '197361', displayName: 'amlodipine', source: 'claims' })
      .returning();
    await db.insert(schema.fill).values({
      patientId: p.id,
      medicationId: m!.id,
      ndc: '99000000201',
      rxcui: '197361',
      fillDate: '2026-10-10',
      daysSupply: 30,
      quantity: '30',
      source: 'mock',
      sourceRef: `eob-${p.id}`,
    });
    await db.insert(schema.warning).values(warningFor(p.id, `k-${p.id}`));
  }
  await db.insert(schema.dataFileVersion).values({
    kind: 'cms_partd',
    label: 'test',
    sourceUrl: 'https://example.test',
    sha256: Buffer.alloc(32, 1),
    effectiveDate: '2026-01-01',
    rowCount: 0,
    loadedBy: 'test',
  });
});
afterAll(closePools);

const count = (u: string, t: typeof schema.warning | typeof schema.fill | typeof schema.medication) =>
  withScope('app', w.scope(u as never), async (db) => (await db.select().from(t)).length);

describe('SECURITY S1 on medicines: the patient policy decides', () => {
  it.each([
    ['asha', 1],
    ['raj', 1],
    ['drrao', 1],
    ['nurseB', 1],
    ['opsA', 0],
    ['opsB', 1],
    ['admin', 2],
    ['sponsor', 0],
  ])('%s sees %i warning(s), fill(s) and medication(s)', async (u, n) => {
    expect(await count(u, schema.warning)).toBe(n);
    expect(await count(u, schema.fill)).toBe(n);
    expect(await count(u, schema.medication)).toBe(n);
  });

  it('asha sees Raj’s warning and not Lata’s', async () => {
    const rows = await withScope('app', w.scope('asha'), (db) => db.select().from(schema.warning));
    expect(rows.map((r) => r.patientId)).toEqual([w.raj.id]);
  });

  it('anonymous requests see no reference data; signed-in requests do', async () => {
    const files = (s: Parameters<typeof withScope>[1]) =>
      withScope('app', s, async (db) => (await db.select().from(schema.dataFileVersion)).length);
    expect(await files(anonymousScope())).toBe(0);
    expect(await files(w.scope('asha'))).toBe(1);
  });
});

describe('writes', () => {
  it('a family member cannot create a warning; staff of the practice can', async () => {
    expect(
      await pgError(
        withScope('app', w.scope('asha'), (db) =>
          db.insert(schema.warning).values(warningFor(w.raj.id, 'x1')),
        ),
      ),
    ).toMatch(/row-level security/);
    await withScope('app', w.scope('drrao'), (db) =>
      db.insert(schema.warning).values(warningFor(w.raj.id, 'x2')),
    );
    expect(
      await pgError(
        withScope('app', w.scope('drrao'), (db) =>
          db.insert(schema.warning).values(warningFor(w.lata.id, 'x3')),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('only admins upload data files', async () => {
    const v = (n: number) => ({
      kind: 'pbm_changes' as const,
      label: 'pbm',
      sourceUrl: 'upload:pbm',
      sha256: Buffer.alloc(32, n),
      effectiveDate: '2026-12-01',
      rowCount: 0,
      loadedBy: 't',
    });
    expect(
      await pgError(
        withScope('app', w.scope('drrao'), (db) => db.insert(schema.dataFileVersion).values(v(2))),
      ),
    ).toMatch(/row-level security/);
    await withScope('app', w.scope('admin'), (db) => db.insert(schema.dataFileVersion).values(v(3)));
  });

  it('Blue Button is connected by the household or the patient, not by staff, and only for their own', async () => {
    const link = (patientId: string) => ({ patientId, mode: 'mock' as const, fhirPatientId: 'mock-x' });
    await withScope('app', w.scope('asha'), (db) => db.insert(schema.bluebuttonLink).values(link(w.raj.id)));
    expect(
      await pgError(
        withScope('app', w.scope('asha'), (db) => db.insert(schema.bluebuttonLink).values(link(w.lata.id))),
      ),
    ).toMatch(/row-level security/);
    expect(
      await pgError(
        withScope('app', w.scope('nurseA'), (db) =>
          db.insert(schema.bluebuttonLink).values(link(w.meera.id)),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('nobody but the worker can bypass: the sponsor sees and writes nothing', async () => {
    expect(await count('sponsor', schema.warning)).toBe(0);
    expect(
      await pgError(
        withScope('app', w.scope('sponsor'), (db) =>
          db.insert(schema.warning).values(warningFor(w.raj.id, 'x4')),
        ),
      ),
    ).toMatch(/row-level security/);
  });
});
