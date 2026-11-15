import { sql, type SQL } from 'drizzle-orm';
import type { ActionItem } from '@tomoni/contracts';
import type { Db } from '@tomoni/db';

type Row = {
  id: string;
  patient_id: string;
  warning_id: string | null;
  skill: string;
  state: ActionItem['state'];
  approval_class: ActionItem['approvalClass'];
  inputs: Record<string, unknown>;
  verify_result: Record<string, unknown> | null;
  do_result: Record<string, unknown> | null;
  updated_at: string | Date;
  drug: string | null;
  to_pharmacy: string | null;
};

/**
 * Actions as the UI sees them: a few named facts, chosen here. Adapter output that is free text
 * (`untrusted`) is never passed on (SECURITY "Agent and prompt-injection defenses").
 */
export async function actionItems(db: Db, where: SQL): Promise<ActionItem[]> {
  const { rows } = await db.execute<Row>(sql`
    SELECT a.id, a.patient_id, a.warning_id, a.skill, a.state, a.approval_class, a.inputs, a.verify_result,
           a.do_result, a.updated_at,
           coalesce(w.evidence->>'drug', (SELECT name FROM care.drug d WHERE d.rxcui = a.inputs->>'rxcui' ORDER BY d.ndc LIMIT 1)) AS drug,
           (SELECT name FROM care.pharmacy WHERE npi = a.inputs->>'toNpi') AS to_pharmacy
      FROM care.action a LEFT JOIN care.warning w ON w.id = a.warning_id
     WHERE ${where}
     ORDER BY a.created_at`);
  return rows.map((r) => {
    const plans = (r.do_result?.plans as { name: string; totalYearlyCents: number }[] | undefined) ?? [];
    return {
      id: r.id,
      patientId: r.patient_id,
      warningId: r.warning_id,
      skill: r.skill,
      state: r.state,
      approvalClass: r.approval_class,
      facts: {
        drug: r.drug,
        toPharmacy: r.to_pharmacy,
        status: typeof r.verify_result?.status === 'string' ? r.verify_result.status : null,
        found: typeof r.verify_result?.found === 'number' ? r.verify_result.found : null,
        bestPlan: plans[0]?.name ?? null,
        bestPlanYearlyCents: plans[0]?.totalYearlyCents ?? null,
      },
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  });
}
