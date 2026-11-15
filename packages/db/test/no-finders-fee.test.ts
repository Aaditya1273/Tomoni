import { afterAll, describe, expect, it } from 'vitest';
import { closePools, pool } from '../src';

/**
 * BUILD_PROMPT rule 2.7. Fails if anyone adds a way to pay clinicians for referrals:
 *  - any money-like column on a table that references care.clinician (or is care.clinician), or
 *  - any money-like column on a table that names clinicians/referrers.
 */
const MONEY = /(payout|commission|bounty|finder|referral_?fee|incentive|bonus|_cents$|amount|rate)/i;

afterAll(closePools);

describe("rule 2.7: no finder's fees", () => {
  it('no table that references a clinician carries a money column', async () => {
    const { rows } = await pool('owner').query<{ table: string; column: string }>(`
      WITH clin_tables AS (
        SELECT 'care.clinician'::text AS t
        UNION
        SELECT conrelid::regclass::text FROM pg_constraint
         WHERE contype = 'f' AND confrelid = 'care.clinician'::regclass
      )
      SELECT c.table_schema || '.' || c.table_name AS table, c.column_name AS column
        FROM information_schema.columns c
        JOIN clin_tables ct ON ct.t = c.table_schema || '.' || c.table_name`);
    const offenders = rows.filter((r) => MONEY.test(r.column));
    expect(offenders).toEqual([]);
  });

  it('no column anywhere pays a clinician, physician, doctor or referrer', async () => {
    const { rows } = await pool('owner').query<{ column: string; table: string }>(`
      SELECT table_schema || '.' || table_name AS table, column_name AS column
        FROM information_schema.columns
       WHERE table_schema IN ('care','research','auth','sponsor')`);
    const offenders = rows.filter(
      (r) => /(clinician|physician|doctor|referrer|prescriber)/i.test(r.column) && MONEY.test(r.column),
    );
    expect(offenders).toEqual([]);
  });
});
