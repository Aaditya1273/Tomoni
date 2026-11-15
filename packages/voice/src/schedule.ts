/**
 * Who gets their daily call now (BUILD_PROMPT §5.4, rule 2.10). Pure: the worker passes
 * candidates and the clock. A call is due when, in the patient's own time zone, it is inside
 * their call window, outside the quiet hours on their contact consent, and they have not had
 * a call scheduled today.
 */
export interface Candidate {
  patientId: string;
  tz: string;
  windowStart: string; // HH:MM[:SS], local
  windowEnd: string;
  quietStart: string; // quiet hours may wrap midnight (20:00 → 09:00)
  quietEnd: string;
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Local calendar date and minute-of-day in a time zone (DST handled by Intl). */
export function localClock(now: Date, tz: string): { date: string; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export const inRange = (minute: number, start: string, end: string) => {
  const s = minutes(start);
  const e = minutes(end);
  return s <= e ? minute >= s && minute < e : minute >= s || minute < e;
};

export function isDue(c: Candidate, now: Date): { due: boolean; localDate: string } {
  const { date, minute } = localClock(now, c.tz);
  const due = inRange(minute, c.windowStart, c.windowEnd) && !inRange(minute, c.quietStart, c.quietEnd);
  return { due, localDate: date };
}

/** The scheduler's idempotency key: at most one scheduled call per patient per local day. */
export const callKey = (patientId: string, localDate: string) => `daily:${patientId}:${localDate}`;
