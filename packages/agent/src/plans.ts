/**
 * Rule 2.11: Medicare plans are ranked by total yearly cost for this person's drugs and nothing
 * else. Any commission is shown beside the plan and is not an input to the ranking: the sort
 * key below reads only the costs.
 */
export interface PlanOption {
  planKey: string;
  name: string;
  premiumCents: number; // monthly
  deductibleCents: number;
  drugCostCents: number; // yearly, at the person's pharmacy
  commissionCents: number | null;
}
export interface RankedPlan extends PlanOption {
  rank: number;
  totalYearlyCents: number;
}

export const totalYearly = (p: Pick<PlanOption, 'premiumCents' | 'deductibleCents' | 'drugCostCents'>) =>
  p.premiumCents * 12 + p.deductibleCents + p.drugCostCents;

export function rankPlans(options: PlanOption[]): RankedPlan[] {
  return options
    .map((p) => ({ ...p, totalYearlyCents: totalYearly(p) }))
    .sort((a, b) => a.totalYearlyCents - b.totalYearlyCents || a.planKey.localeCompare(b.planKey))
    .map((p, i) => ({ ...p, rank: i + 1 }));
}
