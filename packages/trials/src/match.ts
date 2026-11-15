/**
 * Trial Bridge matching (PRODUCT "Engine 1"). Pure: a person's coarse facts against a trial's
 * closed criteria. Only research-registry members with active trial-matching consent are ever
 * passed in; the database refuses to store a match for anyone else (0014).
 */
export type Criterion =
  | { field: 'age_band_min'; value: number }
  | { field: 'age_band_max'; value: number }
  | { field: 'condition_any'; value: string[] }
  | { field: 'drug_any'; value: string[] }
  | { field: 'inpatient_within_days'; value: number }
  | { field: 'language_any'; value: string[] };

export interface Candidate {
  patientId: string;
  age: number;
  language: string;
  conditions: string[]; // chronic condition codes from claims
  rxcuis: string[]; // drugs filled in the last 120 days
  lastInpatientDaysAgo: number | null;
}

export function matches(c: Candidate, criteria: Criterion[]): boolean {
  return criteria.every((k) => {
    switch (k.field) {
      case 'age_band_min':
        return c.age >= k.value;
      case 'age_band_max':
        return c.age <= k.value;
      case 'condition_any':
        return k.value.some((x) => c.conditions.includes(x));
      case 'drug_any':
        return k.value.some((x) => c.rxcuis.includes(x));
      case 'inpatient_within_days':
        return c.lastInpatientDaysAgo !== null && c.lastInpatientDaysAgo <= k.value;
      case 'language_any':
        return k.value.includes(c.language);
    }
  });
}

/** The funnel, in order. Each step after "matched" is work a person does, and some steps are billable (D-010). */
export const STAGES = [
  'matched',
  'prescreened',
  'introduced',
  'consent_prep',
  'referred',
  'randomized',
] as const;
export type Stage = (typeof STAGES)[number] | 'declined' | 'ineligible' | 'withdrawn';
export const BILLABLE: Partial<Record<Stage, string>> = {
  prescreened: 'prescreen_completed',
  introduced: 'introduction_delivered',
  consent_prep: 'consent_prep_call',
  // 'randomized' is deliberately absent: no fee may depend on whether someone was randomized.
};
export function canAdvance(from: Stage, to: Stage): boolean {
  if (to === 'declined' || to === 'ineligible')
    return !['randomized', 'declined', 'ineligible', 'withdrawn'].includes(from);
  // The voice pre-screen is optional: the doctor may introduce straight from a match.
  if (to === 'introduced' && from === 'matched') return true;
  const i = STAGES.indexOf(from as (typeof STAGES)[number]);
  const j = STAGES.indexOf(to as (typeof STAGES)[number]);
  return i >= 0 && j === i + 1;
}
