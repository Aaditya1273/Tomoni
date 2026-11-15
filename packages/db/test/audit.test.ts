import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { systemScope } from '@tomoni/core';
import { audit, closePools, ownerDb, pool, schema, withScope } from '../src';
import { buildWorld, pgError } from './fixtures';

let w: Awaited<ReturnType<typeof buildWorld>>;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(closePools);

const seal = () => withScope('worker', systemScope('audit-sealer'), (db) => db.execute(sql`SELECT audit.seal()`));
const verify = async () =>
  (await withScope('worker', systemScope('audit-verify'), (db) => db.execute<{ v: string | null }>(sql`SELECT audit.verify() AS v`))).rows[0]!.v;

describe('SECURITY S5: audit log', () => {
  it('records the actor from the request scope, not from arguments', async () => {
    await withScope('app', w.scope('drrao'), (db) =>
      audit(db, { action: 'read', entityType: 'patient', entityId: w.raj.id, patientId: w.raj.id, purpose: 'treatment' }),
    );
    const [row] = await ownerDb()
      .select()
      .from(schema.auditEvent)
      .where(sql`entity_id = ${w.raj.id}`)
      .orderBy(sql`id DESC`)
      .limit(1);
    expect(row!.actorId).toBe(w.users.drrao);
    expect(row!.actorRoles).toEqual(['physician']);
    expect(row!.hash).toBeNull(); // unsealed until the sealer runs
  });

  it('seals into an intact chain', async () => {
    for (let i = 0; i < 5; i++) {
      await withScope('app', w.scope('nurseA'), (db) =>
        audit(db, { action: 'read', entityType: 'patient', entityId: w.sam.id, patientId: w.sam.id, purpose: 'treatment' }),
      );
    }
    await seal();
    expect(await verify()).toBeNull();
  });

  it('the app role cannot update, delete or insert directly', async () => {
    for (const q of [
      sql`UPDATE audit.event SET purpose = 'support'`,
      sql`DELETE FROM audit.event`,
      sql`INSERT INTO audit.event (actor_kind, actor_id, action, entity_type, purpose) VALUES ('user','x','read','x','support')`,
    ]) {
      expect(await pgError(withScope('app', w.scope('admin'), (db) => db.execute(q)))).toMatch(/permission denied/);
    }
  });

  it('even the owner is blocked by the append-only trigger', async () => {
    await expect(pool('owner').query(`UPDATE audit.event SET purpose = 'support'`)).rejects.toThrow(/append-only/);
    await expect(pool('owner').query(`DELETE FROM audit.event`)).rejects.toThrow(/append-only/);
    await expect(pool('owner').query(`TRUNCATE audit.event`)).rejects.toThrow(/append-only/);
  });

  it('detects tampering when the trigger is bypassed', async () => {
    await seal();
    const c = await pool('owner').connect();
    try {
      await c.query('BEGIN');
      await c.query('ALTER TABLE audit.event DISABLE TRIGGER guard_update');
      await c.query(`UPDATE audit.event SET details = '{"forged":true}' WHERE chain_seq = 2`);
      const { rows } = await c.query('SELECT audit.verify() AS v');
      expect(rows[0].v).toBe('2');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
    expect(await verify()).toBeNull(); // rolled back
  });

  it('family can see who accessed their own relative', async () => {
    const rows = await withScope('app', w.scope('asha'), (db) =>
      db.select().from(schema.auditEvent).where(sql`patient_id = ${w.raj.id}`),
    );
    expect(rows.length).toBeGreaterThan(0);
    const other = await withScope('app', w.scope('asha'), (db) =>
      db.select().from(schema.auditEvent).where(sql`patient_id = ${w.sam.id}`),
    );
    expect(other).toHaveLength(0);
  });
});
