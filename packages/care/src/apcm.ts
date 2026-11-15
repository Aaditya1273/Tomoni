/**
 * APCM (Advanced Primary Care Management) evidence, month by month. Medicare pays the practice
 * per enrolled patient per month (G0556/G0557/G0558) when there is documented consent with the
 * co-pay disclosure, a care plan, and services actually delivered. Tomoni assembles exactly that
 * and nothing more; the physician signs and the practice bills.
 */

/** CY2026 national rates (Medicare Physician Fee Schedule final rule). Used for the practice report only. */
export const APCM_RATE_CENTS = { G0556: 1637, G0557: 5378, G0558: 11724 } as const;
export type Hcpcs = keyof typeof APCM_RATE_CENTS;

/** Chronic condition groups by ICD-10 prefix. A patient's count decides the code. */
export const CHRONIC: { code: string; name: string; prefixes: string[] }[] = [
  { code: 'diabetes', name: 'Type 2 diabetes', prefixes: ['E08', 'E09', 'E10', 'E11', 'E13'] },
  { code: 'hypertension', name: 'High blood pressure', prefixes: ['I10', 'I11', 'I12', 'I13', 'I15', 'I16'] },
  { code: 'hyperlipidemia', name: 'High cholesterol', prefixes: ['E78'] },
  {
    code: 'coronary_artery_disease',
    name: 'Coronary artery disease',
    prefixes: ['I20', 'I21', 'I22', 'I24', 'I25'],
  },
  { code: 'heart_failure', name: 'Heart failure', prefixes: ['I50'] },
  { code: 'atrial_fibrillation', name: 'Atrial fibrillation', prefixes: ['I48'] },
  { code: 'copd', name: 'COPD', prefixes: ['J43', 'J44'] },
  { code: 'asthma', name: 'Asthma', prefixes: ['J45'] },
  { code: 'ckd', name: 'Chronic kidney disease', prefixes: ['N18'] },
  { code: 'hypothyroidism', name: 'Underactive thyroid', prefixes: ['E03'] },
  { code: 'dementia', name: 'Dementia', prefixes: ['F01', 'F02', 'F03', 'G30'] },
  { code: 'depression', name: 'Depression', prefixes: ['F32', 'F33'] },
  { code: 'osteoarthritis', name: 'Osteoarthritis', prefixes: ['M15', 'M16', 'M17', 'M18', 'M19'] },
  { code: 'bph', name: 'Enlarged prostate', prefixes: ['N40'] },
];

export function chronicConditions(dxCodes: string[]): { code: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const dx of dxCodes) {
    const d = dx.toUpperCase().replace('.', '');
    const hit = CHRONIC.find((c) => c.prefixes.some((p) => d.startsWith(p)));
    if (hit) seen.set(hit.code, hit.name);
  }
  return [...seen].map(([code, name]) => ({ code, name }));
}

/** G0556: 0–1 chronic conditions; G0557: 2 or more; G0558: 2 or more and a QMB. */
export function hcpcsFor(conditionCount: number, qmb: boolean): Hcpcs {
  if (conditionCount < 2) return 'G0556';
  return qmb ? 'G0558' : 'G0557';
}

export interface MonthFacts {
  consentId: string | null;
  carePlanId: string | null;
  services: { kind: string; at: string; ref: string }[];
}

/** What a month record says. Missing evidence excludes the month, with the reason, never guesses. */
export function evaluateMonth(f: MonthFacts): {
  status: 'ready' | 'excluded';
  exclusionReason: string | null;
} {
  if (!f.consentId) return { status: 'excluded', exclusionReason: 'no APCM consent in effect this month' };
  if (!f.carePlanId) return { status: 'excluded', exclusionReason: 'no signed care plan' };
  if (!f.services.length) return { status: 'excluded', exclusionReason: 'no services delivered this month' };
  return { status: 'ready', exclusionReason: null };
}

export const monthBounds = (month: string) => {
  const start = `${month.slice(0, 7)}-01`;
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return { start, next: d.toISOString().slice(0, 10) };
};
