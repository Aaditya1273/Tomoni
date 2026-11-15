import type { AccessStatus } from '@tomoni/contracts';
import type { Status } from '@tomoni/ui';

export const statusOf: Record<AccessStatus, Status> = { green: 'ok', amber: 'watch', red: 'act' };

/** "metformin hydrochloride 500 MG Oral Tablet" → "Metformin hydrochloride 500 mg tablet". */
export function drugName(rxnorm: string): string {
  const s = rxnorm
    .replace(/\b24 HR\b/g, '')
    .replace(/\bOral\b/g, '')
    .replace(/\b(MG|MCG|ML|ACTUAT)\b/g, (u) => u.toLowerCase())
    .replace(/\b(Tablet|Capsule|Inhaler|Solution)\b/g, (f) => f.toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** ISO date (YYYY-MM-DD) as a Date at noon UTC, so formatting never slips a day. */
export const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
