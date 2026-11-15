/**
 * Call streak with a shield (BUILD_PROMPT §5.5): consecutive days with a completed call, counting
 * back from today. One missed day in any 7 is forgiven (the shield), so a single bad day doesn't
 * erase a month. Pure; dates are the patient's local calendar days.
 */
export function callStreak(callDays: Set<string>, today: string): { days: number; shieldUsed: boolean } {
  const d = new Date(`${today}T12:00:00Z`);
  // Today's call may not have happened yet: start from yesterday if today is empty.
  if (!callDays.has(today)) d.setUTCDate(d.getUTCDate() - 1);
  let days = 0;
  let lastShield = -Infinity;
  let shieldUsed = false;
  let pending = false; // a shield only counts once a call before the gap extends the streak
  for (let i = 0; i < 400; i++) {
    const key = d.toISOString().slice(0, 10);
    if (callDays.has(key)) {
      days++;
      if (pending) shieldUsed = true;
      pending = false;
    } else if (i - lastShield >= 7 && days > 0 && !pending) {
      lastShield = i;
      pending = true;
    } else break;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return { days, shieldUsed };
}
