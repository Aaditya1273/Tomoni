import { describe, expect, it } from 'vitest';
import { callStreak } from '../src/family/streaks';

const days = (...d: string[]) => new Set(d);
describe('call streak with a shield', () => {
  it('counts consecutive days, starting yesterday if today has no call yet', () => {
    expect(callStreak(days('2026-11-14', '2026-11-13', '2026-11-12'), '2026-11-15')).toEqual({
      days: 3,
      shieldUsed: false,
    });
    expect(callStreak(days('2026-11-15', '2026-11-14'), '2026-11-15')).toEqual({
      days: 2,
      shieldUsed: false,
    });
  });
  it('one missed day a week is forgiven; two in a row are not', () => {
    expect(callStreak(days('2026-11-14', '2026-11-12', '2026-11-11'), '2026-11-15')).toEqual({
      days: 3,
      shieldUsed: true,
    });
    expect(callStreak(days('2026-11-14', '2026-11-11'), '2026-11-15').days).toBe(1);
  });
  it('a gap with nothing before it uses no shield', () => {
    expect(callStreak(days('2026-11-14'), '2026-11-15')).toEqual({ days: 1, shieldUsed: false });
  });
  it('no calls, no streak', () => {
    expect(callStreak(days(), '2026-11-15')).toEqual({ days: 0, shieldUsed: false });
  });
});
