/** Care-plan drafts and APCM month records against the database (runs in the caller's scope). */
import { and, desc, eq, sql } from 'drizzle-orm';
import { audit, schema, type Db } from '@tomoni/db';
import type { CarePlanBody } from '@tomoni/db/schema';
import { chronicConditions, evaluateMonth, hcpcsFor, monthBounds } from './apcm';

const GOALS: Record<string, string> = {
  diabetes: 'Blood sugar in the range Dr. sets; diabetes medicines taken every day.',
  hypertension: 'Blood pressure in the target range; blood pressure medicines taken every day.',
  hyperlipidemia: 'Cholesterol medicine taken every day; levels checked as Dr. orders.',
  coronary_artery_disease: 'No missed doses of heart medicines; chest pain reported the same day.',
  heart_failure: 'Breathlessness or swelling reported the same day; weight checked as Dr. orders.',
  copd: 'Inhalers never run out; worse breathing reported the same day.',
};

async function dxCodes(db: Db, patientId: string): Promise<string[]> {
  const { rows } = await db.execute<{ dx: string }>(sql`
    SELECT DISTINCT unnest(dx_codes) AS dx FROM care.claim
     WHERE patient_id = ${patientId} AND start_date > now() - interval '12 months'`);
  return rows.map((r) => r.dx);
}

/**
 * A draft from what Tomoni knows: conditions from claims, current medicines, the family. The
 * physician reviews and signs; until then it is only a draft. An open draft is reused.
 */
export async function draftCarePlan(db: Db, patientId: string, draftedBy: string) {
  const [open] = await db
    .select()
    .from(schema.carePlan)
    .where(and(eq(schema.carePlan.patientId, patientId), eq(schema.carePlan.status, 'draft')));
  if (open) return open;
  const problems = chronicConditions(await dxCodes(db, patientId));
  const meds = await db
    .select({ name: schema.medication.displayName })
    .from(schema.medication)
    .where(and(eq(schema.medication.patientId, patientId), eq(schema.medication.active, true)));
  const [p] = await db
    .select({ householdId: schema.patient.householdId })
    .from(schema.patient)
    .where(eq(schema.patient.id, patientId));
  const family = await db
    .select({ name: schema.familyMember.displayName, role: schema.familyMember.relationship })
    .from(schema.familyMember)
    .where(eq(schema.familyMember.householdId, p!.householdId));
  const body: CarePlanBody = {
    problems,
    goals: problems.map((x) => GOALS[x.code]).filter((g): g is string => !!g),
    medications: meds.map((m) => m.name).sort(),
    interventions: [
      'Daily Tomoni check-in call in the patient’s language; symptoms go to the nurse the same day.',
      'Medicine early warnings: run-outs, plan and price changes, pharmacy closures.',
      'Refill renewals and pharmacy work prepared by Tomoni and signed by the physician.',
    ],
    contacts: family.map((f) => ({ name: f.name, role: f.role })),
  };
  const [{ v }] = (
    await db.execute<{ v: number }>(
      sql`SELECT coalesce(max(version), 0)::int + 1 AS v FROM care.care_plan WHERE patient_id = ${patientId}`,
    )
  ).rows as [{ v: number }];
  const [row] = await db
    .insert(schema.carePlan)
    .values({ patientId, version: v, body, draftedBy })
    .returning();
  await audit(db, {
    action: 'create',
    entityType: 'care_plan',
    entityId: row!.id,
    patientId,
    purpose: 'treatment',
    details: { version: v },
  });
  return row!;
}

/** Edit a draft's goals and interventions. Null when it isn't a draft at that revision. */
export async function editCarePlan(
  db: Db,
  planId: string,
  revision: number,
  edit: Pick<CarePlanBody, 'goals' | 'interventions'>,
) {
  const [plan] = await db.select().from(schema.carePlan).where(eq(schema.carePlan.id, planId)).for('update');
  if (!plan || plan.status !== 'draft' || plan.revision !== revision) return null;
  const [row] = await db
    .update(schema.carePlan)
    .set({ body: { ...plan.body, ...edit }, revision: revision + 1 })
    .where(eq(schema.carePlan.id, planId))
    .returning();
  await audit(db, {
    action: 'update',
    entityType: 'care_plan',
    entityId: planId,
    patientId: plan.patientId,
    purpose: 'treatment',
    details: { edited: true, version: plan.version, revision: revision + 1 },
  });
  return row!;
}

/**
 * Sign a draft at the revision the physician saw: the previous signed version is superseded in
 * the same transaction. Null when there is no such draft, or it changed since.
 */
export async function signCarePlan(db: Db, planId: string, physicianUserId: string, revision: number) {
  const [plan] = await db.select().from(schema.carePlan).where(eq(schema.carePlan.id, planId)).for('update');
  if (!plan || plan.status !== 'draft' || plan.revision !== revision) return null;
  await db
    .update(schema.carePlan)
    .set({ status: 'superseded' })
    .where(and(eq(schema.carePlan.patientId, plan.patientId), eq(schema.carePlan.status, 'signed')));
  const [signed] = await db
    .update(schema.carePlan)
    .set({ status: 'signed', signedBy: physicianUserId, signedAt: new Date() })
    .where(eq(schema.carePlan.id, planId))
    .returning();
  await audit(db, {
    action: 'update',
    entityType: 'care_plan',
    entityId: planId,
    patientId: plan.patientId,
    purpose: 'treatment',
    details: { signed: true, version: plan.version },
  });
  return signed!;
}

/**
 * Build (or rebuild) the APCM records for every patient of these practices enrolled during the
 * month. Billed months are never touched.
 */
export async function buildApcmMonth(db: Db, practiceIds: string[], month: string) {
  const { start, next } = monthBounds(month);
  const { rows: enrolled } = await db.execute<{
    patient_id: string;
    practice_id: string;
    qmb: boolean;
    consent_id: string;
    plan_id: string | null;
  }>(sql`
    SELECT p.id AS patient_id, p.practice_id, p.qmb, cc.id AS consent_id,
           (SELECT cp.id FROM care.care_plan cp WHERE cp.patient_id = p.id AND cp.signed_at < ${next}::date
             ORDER BY cp.signed_at DESC LIMIT 1) AS plan_id
      FROM care.patient p
      JOIN care.care_consent cc ON cc.patient_id = p.id AND cc.program = 'apcm' AND cc.copay_disclosed
                               AND cc.given_at < ${next}::date
                               AND (cc.withdrawn_at IS NULL OR cc.withdrawn_at >= ${start}::date)
     WHERE p.practice_id = ANY(${sql.param(practiceIds)}::uuid[])`);
  let ready = 0;
  for (const e of enrolled) {
    const { rows: services } = await db.execute<{ kind: string; at: string; ref: string }>(sql`
      SELECT 'daily_call' AS kind, started_at::text AS at, id::text AS ref FROM care.call
       WHERE patient_id = ${e.patient_id} AND outcome IN ('completed','escalated')
         AND started_at >= ${start}::date AND started_at < ${next}::date
      UNION ALL
      SELECT 'nurse_flag_handled', acknowledged_at::text, id::text FROM care.nurse_flag
       WHERE patient_id = ${e.patient_id} AND acknowledged_at >= ${start}::date AND acknowledged_at < ${next}::date
      UNION ALL
      SELECT 'care_coordination:' || skill, updated_at::text, id::text FROM care.action
       WHERE patient_id = ${e.patient_id} AND state = 'succeeded'
         AND updated_at >= ${start}::date AND updated_at < ${next}::date
      UNION ALL
      SELECT 'care_plan_signed', signed_at::text, id::text FROM care.care_plan
       WHERE patient_id = ${e.patient_id} AND signed_at >= ${start}::date AND signed_at < ${next}::date
      ORDER BY 2`);
    const conditions = chronicConditions(await dxCodes(db, e.patient_id)).map((c) => c.code);
    const verdict = evaluateMonth({ consentId: e.consent_id, carePlanId: e.plan_id, services });
    if (verdict.status === 'ready') ready++;
    const values = {
      hcpcs: hcpcsFor(conditions.length, e.qmb),
      chronicConditions: conditions,
      consentId: e.consent_id,
      carePlanId: e.plan_id,
      services,
      status: verdict.status,
      exclusionReason: verdict.exclusionReason,
    };
    await db
      .insert(schema.apcmMonthRecord)
      .values({ patientId: e.patient_id, practiceId: e.practice_id, month: start, ...values })
      .onConflictDoUpdate({
        target: [schema.apcmMonthRecord.patientId, schema.apcmMonthRecord.month],
        set: values,
        setWhere: sql`care.apcm_month_record.status <> 'billed'`,
      });
  }
  await audit(db, {
    action: 'create',
    entityType: 'apcm_month',
    purpose: 'payment',
    details: { month: start, patients: enrolled.length, ready },
  });
  return { month: start, patients: enrolled.length, ready };
}

export async function latestPlans(db: Db, patientId: string) {
  return db
    .select()
    .from(schema.carePlan)
    .where(eq(schema.carePlan.patientId, patientId))
    .orderBy(desc(schema.carePlan.version))
    .limit(5);
}
