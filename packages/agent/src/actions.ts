/**
 * Proposing and running actions against the database (rule 2.3: confirm → do → verify).
 * Every step is its own transaction and its result is saved before the next one starts, so a
 * crash or retry never repeats a `do` that already happened (adapters also get an idempotency
 * key). Actions are proposed by the system, never written by callers.
 */
import { eq, sql } from 'drizzle-orm';
import { audit, schema, type Db } from '@tomoni/db';
import type { Adapters } from './adapters';
import { rankPlans } from './plans';
import { SKILL_FOR_WARNING, SKILLS, isSkill, type SkillName } from './registry';
import { backoffMs, MAX_ATTEMPTS, move, type ActionState } from './state';

type Tx = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
type Json = Record<string, unknown>;

export interface Proposed {
  id: string;
  skill: SkillName;
  state: ActionState;
  created: boolean;
}

/** One warning → its closed-table skill, with inputs taken from the warning, never from text. */
export async function proposeForWarning(
  db: Db,
  warningId: string,
  source: 'call' | 'family_app' | 'desk',
): Promise<Proposed[]> {
  const [w] = await db.select().from(schema.warning).where(eq(schema.warning.id, warningId));
  if (!w || w.status !== 'open') return [];
  const [p] = await db
    .select({
      practiceId: schema.patient.practiceId,
      householdId: schema.patient.householdId,
      region: schema.household.region,
    })
    .from(schema.patient)
    .innerJoin(schema.household, eq(schema.household.id, schema.patient.householdId))
    .where(eq(schema.patient.id, w.patientId));
  // India: the family is who acts, and only when the parent asked on the call.
  const india = p?.region === 'IN';
  if (india && source !== 'call') return [];
  const skill: SkillName | undefined = india ? 'askFamilyToHelp' : SKILL_FOR_WARNING[w.type];
  if (!skill) return [];

  let inputs: Json[];
  if (skill === 'askFamilyToHelp') inputs = [{}];
  else if (skill === 'comparePartDPlans') inputs = [{ year: Number(w.problemDate.slice(0, 4)) }];
  else if (skill === 'requestPharmacyTransfer') {
    // Closure: move each affected medicine to the first pharmacy that is not closing.
    const ev = w.evidence as { fillIds?: string[] };
    const { rows } = await db.execute<{ rxcui: string; to_npi: string | null }>(sql`
      SELECT DISTINCT f.rxcui,
             (SELECT ph.npi FROM care.pharmacy ph
               WHERE ph.id <> f.pharmacy_id AND ph.id NOT IN (SELECT pharmacy_id FROM care.pharmacy_closure)
               ORDER BY ph.npi LIMIT 1) AS to_npi
        FROM care.fill f WHERE f.id = ANY(${sql.param(ev.fillIds ?? [])}::uuid[]) AND f.rxcui IS NOT NULL`);
    inputs = rows.filter((r) => r.to_npi).map((r) => ({ rxcui: r.rxcui, toNpi: r.to_npi }));
  } else inputs = w.rxcui ? [{ rxcui: w.rxcui }] : [];

  const out: Proposed[] = [];
  for (const raw of inputs) {
    const def = SKILLS[skill];
    const parsed = def.input.safeParse(raw);
    if (!parsed.success) continue;
    const state: ActionState = def.approval === 'none' ? 'approved' : 'awaiting_approval';
    const key = `${skill}:${warningId}:${JSON.stringify(parsed.data)}`;
    const [row] = await db
      .insert(schema.action)
      .values({
        patientId: w.patientId,
        warningId,
        skill,
        skillVersion: def.version,
        inputs: parsed.data as Json,
        approvalClass: def.approval,
        state,
        idempotencyKey: key,
      })
      .onConflictDoNothing({ target: schema.action.idempotencyKey })
      .returning({ id: schema.action.id });
    if (!row) {
      const [existing] = await db
        .select({ id: schema.action.id, state: schema.action.state })
        .from(schema.action)
        .where(eq(schema.action.idempotencyKey, key));
      if (existing) out.push({ id: existing.id, skill, state: existing.state, created: false });
      continue;
    }
    await db.insert(schema.outbox).values({
      topic: 'action.proposed',
      aggregateType: 'action',
      aggregateId: row.id,
      practiceId: p!.practiceId,
      householdId: p!.householdId,
      payload: { skill, approval: def.approval, state },
    });
    await audit(db, {
      action: 'agent_action',
      entityType: 'action',
      entityId: row.id,
      patientId: w.patientId,
      purpose: 'treatment',
      details: { skill, step: 'proposed', source, approval: def.approval },
    });
    out.push({ id: row.id, skill, state, created: true });
  }
  return out;
}

export type RunResult =
  | { state: 'succeeded' | 'handoff' | 'failed' }
  | { state: 'approved'; retryInMs: number }
  | { skipped: string };

export async function runAction(
  tx: Tx,
  actionId: string,
  adapters: Adapters,
  today: string,
): Promise<RunResult> {
  // 1. Claim: only an approved action runs, once at a time.
  const claimed = await tx(async (db) => {
    const [a] = await db
      .execute<{ id: string }>(sql`SELECT id FROM care.action WHERE id = ${actionId} FOR UPDATE`)
      .then((r) => r.rows);
    if (!a) return null;
    const [row] = await db.select().from(schema.action).where(eq(schema.action.id, actionId));
    if (row!.state !== 'approved') return { skip: row!.state };
    await db
      .update(schema.action)
      .set({ state: move('approved', 'running'), attempts: sql`attempts + 1` })
      .where(eq(schema.action.id, actionId));
    const { rows } = await db.execute<{ npi: string | null; others: string[] }>(sql`
      SELECT (SELECT ph.npi FROM care.fill f JOIN care.pharmacy ph ON ph.id = f.pharmacy_id
               WHERE f.patient_id = ${row!.patientId} ORDER BY f.fill_date DESC LIMIT 1) AS npi,
             coalesce((SELECT array_agg(npi ORDER BY npi) FROM care.pharmacy
                        WHERE id NOT IN (SELECT pharmacy_id FROM care.pharmacy_closure)), '{}') AS others`);
    return {
      row: { ...row!, attempts: row!.attempts + 1 },
      facts: {
        pharmacyNpi: rows[0]?.npi ?? null,
        otherPharmacyNpis: (rows[0]?.others ?? []).filter((n) => n !== rows[0]?.npi),
        today,
      },
    };
  });
  if (!claimed) return { skipped: 'not found' };
  if ('skip' in claimed) return { skipped: `state is ${claimed.skip}` };
  const { row: a, facts } = claimed;

  const save = (patch: Partial<typeof schema.action.$inferInsert>, step: string) =>
    tx(async (db) => {
      await db.update(schema.action).set(patch).where(eq(schema.action.id, actionId));
      await audit(db, {
        action: 'agent_action',
        entityType: 'action',
        entityId: actionId,
        patientId: a.patientId,
        purpose: 'treatment',
        details: { skill: a.skill, step },
      });
    });

  if (!isSkill(a.skill) || SKILLS[a.skill].version !== a.skillVersion) {
    await save({ state: move('running', 'handoff'), handoffReason: 'skill version changed' }, 'handoff');
    return { state: 'handoff' };
  }
  const skill = SKILLS[a.skill];
  const inputs = skill.input.safeParse(a.inputs);
  if (!inputs.success) {
    await save(
      { state: move('running', 'failed'), handoffReason: 'inputs no longer match the skill schema' },
      'failed',
    );
    return { state: 'failed' };
  }
  const ctx = { adapters, idempotencyKey: a.idempotencyKey, facts };

  try {
    // 2. confirm → do → verify, each saved before the next; a retry resumes where it stopped.
    const confirmed = a.confirmResult ?? (await skill.confirm(inputs.data as never, ctx));
    if (!a.confirmResult) await save({ confirmResult: confirmed }, 'confirmed');
    let done = a.doResult;
    if (!done) {
      done =
        a.skill === 'comparePartDPlans'
          ? await comparePlans(tx, a.patientId, Number(confirmed.year))
          : await skill.do(inputs.data as never, ctx, confirmed);
      await save({ doResult: done }, 'done');
    }
    await save({ state: move('running', 'verifying') }, 'verifying');
    const verified = await skill.verify(inputs.data as never, ctx, done);
    if (!verified.ok) throw new Error('verification did not match');
    await save({ state: move('verifying', 'succeeded'), verifyResult: verified }, 'verified');
    await tx((db) => announce(db, actionId, a.patientId, 'action.succeeded'));
    return { state: 'succeeded' };
  } catch (e) {
    const reason = (e as Error).message.slice(0, 200);
    const now = (
      await tx((db) =>
        db.select({ s: schema.action.state }).from(schema.action).where(eq(schema.action.id, actionId)),
      )
    )[0]!.s;
    if (a.attempts >= MAX_ATTEMPTS) {
      await save({ state: move(now, 'handoff'), handoffReason: reason }, 'handoff');
      await tx((db) => announce(db, actionId, a.patientId, 'action.handoff'));
      return { state: 'handoff' };
    }
    const delay = backoffMs(a.attempts);
    await save({ state: move(now, 'approved'), nextAttemptAt: new Date(Date.now() + delay) }, 'retry');
    return { state: 'approved', retryInMs: delay };
  }
}

async function announce(db: Db, actionId: string, patientId: string, topic: string) {
  const [p] = await db
    .select({ practiceId: schema.patient.practiceId, householdId: schema.patient.householdId })
    .from(schema.patient)
    .where(eq(schema.patient.id, patientId));
  await db.insert(schema.outbox).values({
    topic,
    aggregateType: 'action',
    aggregateId: actionId,
    practiceId: p!.practiceId,
    householdId: p!.householdId,
    payload: {},
  });
}

/** Rule 2.11: every plan for the year, ranked by this person's total yearly cost only. */
async function comparePlans(tx: Tx, patientId: string, year: number) {
  return tx(async (db) => {
    const { rows } = await db.execute<{
      plan_key: string;
      name: string;
      premium_cents: number;
      deductible_cents: number;
      drug_cents: string;
    }>(sql`
      WITH v AS (SELECT DISTINCT ON (contract_id, plan_id, segment_id) p.*
                   FROM care.plan p JOIN care.data_file_version d ON d.id = p.version_id
                  WHERE p.year = ${year} ORDER BY contract_id, plan_id, segment_id, d.effective_date DESC),
           meds AS (SELECT DISTINCT rxcui FROM care.fill WHERE patient_id = ${patientId} AND rxcui IS NOT NULL
                       AND fill_date > now() - interval '120 days')
      SELECT v.contract_id || '-' || v.plan_id || '-' || v.segment_id AS plan_key, v.name, v.premium_cents,
             v.deductible_cents,
             coalesce((SELECT sum(round(dp.unit_cost * 365 * 100)) FROM care.drug_price dp
                        WHERE dp.version_id = v.version_id AND dp.contract_id = v.contract_id
                          AND dp.plan_id = v.plan_id AND dp.segment_id = v.segment_id AND dp.days_supply = 30
                          AND dp.rxcui IN (SELECT rxcui FROM meds)), 0)::text AS drug_cents
        FROM v`);
    // ponytail: yearly drug cost = unit cost × 365 (one a day), the same estimate as D-019.
    const ranked = rankPlans(
      rows.map((r) => ({
        planKey: r.plan_key,
        name: r.name,
        premiumCents: r.premium_cents,
        deductibleCents: r.deductible_cents,
        drugCostCents: Number(r.drug_cents),
        commissionCents: null, // no broker relationship exists; shown as "none" when there is
      })),
    );
    return { year, plans: ranked };
  });
}
