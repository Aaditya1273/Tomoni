import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonymousScope } from '@tomoni/core';
import { closePools, schema, withScope, type Db } from '../src';
import { eq } from 'drizzle-orm';
import { buildWorld, pgError } from './fixtures';

let w: Awaited<ReturnType<typeof buildWorld>>;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(closePools);

const names = async (db: Db) =>
  (await db.select({ name: schema.patient.name }).from(schema.patient)).map((r) => r.name).sort();

describe('SECURITY S1: who sees which patients', () => {
  const cases: [string, string[]][] = [
    ['asha', ['Meera Patel', 'Raj Patel']], // her household only
    ['raj', ['Raj Patel']], // himself only, not his wife
    ['drrao', ['Meera Patel', 'Raj Patel', 'Sam Brown']], // practice A
    ['nurseA', ['Meera Patel', 'Raj Patel', 'Sam Brown']],
    ['nurseB', ['Lata Iyer']], // practice B only
    ['opsA', []], // practice A has offshore ops access OFF (D-008)
    ['opsB', ['Lata Iyer']], // practice B allows it
    ['admin', ['Lata Iyer', 'Meera Patel', 'Raj Patel', 'Sam Brown']],
    ['sponsor', []], // sponsors never see patients
  ];
  it.each(cases)('%s sees %j', async (user, expected) => {
    expect(await withScope('app', w.scope(user as never), names)).toEqual(expected);
  });

  it('an anonymous request sees nothing', async () => {
    expect(await withScope('app', anonymousScope(), names)).toEqual([]);
  });

  it('child tables follow the patient policy (consents)', async () => {
    const seen = (u: string) =>
      withScope(
        'app',
        w.scope(u as never),
        async (db) => (await db.select().from(schema.careConsent)).length,
      );
    expect(await seen('asha')).toBe(1);
    expect(await seen('drrao')).toBe(1);
    expect(await seen('nurseB')).toBe(0);
    expect(await seen('opsA')).toBe(0);
  });

  it('households and family members follow too', async () => {
    const fm = await withScope('app', w.scope('nurseB'), (db) => db.select().from(schema.familyMember));
    expect(fm).toHaveLength(0);
    const fm2 = await withScope('app', w.scope('drrao'), (db) => db.select().from(schema.familyMember));
    expect(fm2.map((f) => f.displayName)).toEqual(['Asha']);
  });

  it('practices: family sees only their own practice', async () => {
    const ps = await withScope('app', w.scope('asha'), (db) => db.select().from(schema.practice));
    expect(ps.map((p) => p.name)).toEqual(['Rao Family Medicine']);
  });
});

describe('SECURITY S1: who can write', () => {
  it('a nurse at B cannot update a patient at A (0 rows touched), but can update her own', async () => {
    const upd = (id: string) =>
      withScope('app', w.scope('nurseB'), (db) =>
        db
          .update(schema.patient)
          .set({ locale: 'ta' })
          .where(eq(schema.patient.id, id))
          .returning({ id: schema.patient.id }),
      );
    expect(await upd(w.raj.id)).toHaveLength(0);
    expect(await upd(w.lata.id)).toHaveLength(1);
  });

  it('a family member cannot update a patient', async () => {
    const rows = await withScope('app', w.scope('asha'), (db) =>
      db.update(schema.patient).set({ locale: 'en' }).returning({ id: schema.patient.id }),
    );
    expect(rows).toHaveLength(0);
  });

  it('a nurse cannot insert a patient into another practice', async () => {
    expect(
      await pgError(
        withScope('app', w.scope('nurseB'), (db) =>
          db.insert(schema.patient).values({
            practiceId: w.A.id,
            householdId: w.H1.id,
            name: 'X',
            dob: '1950-01-01',
            birthYear: 1950,
            state: 'NJ',
            locale: 'en',
            tz: 'America/New_York',
            medicareType: 'original',
          }),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('the app role cannot delete patients at all', async () => {
    expect(await pgError(withScope('app', w.scope('admin'), (db) => db.delete(schema.patient)))).toMatch(
      /permission denied/,
    );
  });

  it('the app role cannot read sessions or other users', async () => {
    expect(
      await pgError(withScope('app', w.scope('admin'), (db) => db.select().from(schema.session))),
    ).toMatch(/permission denied/);
    const me = await withScope('app', w.scope('asha'), (db) => db.select().from(schema.userAccount));
    expect(me.map((u) => u.email)).toEqual(['asha@test.local']);
  });
});
