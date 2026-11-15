import { describe, expect, it } from 'vitest';
import { idleTimeoutFor, requiresMfa, scopeFromGrants, surfacesFor, type RoleGrant } from '../src';

const g = (role: RoleGrant['role'], ids: Partial<RoleGrant> = {}): RoleGrant => ({
  role,
  practiceId: null,
  householdId: null,
  patientId: null,
  sponsorId: null,
  ...ids,
});

describe('scopeFromGrants', () => {
  it('keeps each role family in its own list', () => {
    const s = scopeFromGrants('u1', [
      g('nurse', { practiceId: 'P1' }),
      g('family_member', { householdId: 'H9' }),
    ]);
    expect(s.staffPracticeIds).toEqual(['P1']);
    expect(s.householdIds).toEqual(['H9']);
    expect(s.opsPracticeIds).toEqual([]);
    expect(s.patientIds).toEqual([]);
    expect(s.isAdmin).toBe(false);
  });

  it('ops practices never become staff practices', () => {
    const s = scopeFromGrants('u1', [g('ops_agent', { practiceId: 'P1' })]);
    expect(s.staffPracticeIds).toEqual([]);
    expect(s.opsPracticeIds).toEqual(['P1']);
  });

  it('patients and representatives scope to patient ids', () => {
    const s = scopeFromGrants('u1', [
      g('representative', { patientId: 'X' }),
      g('patient', { patientId: 'Y' }),
    ]);
    expect(s.patientIds.sort()).toEqual(['X', 'Y']);
  });

  it('dedupes', () => {
    const s = scopeFromGrants('u1', [g('nurse', { practiceId: 'P1' }), g('physician', { practiceId: 'P1' })]);
    expect(s.staffPracticeIds).toEqual(['P1']);
    expect(s.staffRoles.sort()).toEqual(['nurse', 'physician']);
  });
});

describe('session policy', () => {
  it('requires MFA and short idle timeout for clinical, ops, sponsor, admin', () => {
    for (const r of ['physician', 'nurse', 'front_desk', 'ops_agent', 'sponsor_user', 'admin'] as const) {
      expect(requiresMfa([r])).toBe(true);
      expect(idleTimeoutFor([r])).toBe(900);
    }
  });
  it('family-side roles get no MFA requirement and a 7-day idle window', () => {
    for (const r of ['patient', 'family_member', 'representative'] as const) {
      expect(requiresMfa([r])).toBe(false);
      expect(idleTimeoutFor([r])).toBe(7 * 24 * 3600);
    }
  });
  it('a family member who is also a nurse gets the strict policy', () => {
    expect(requiresMfa(['family_member', 'nurse'])).toBe(true);
  });
  it('maps roles to surfaces', () => {
    expect(surfacesFor(['nurse', 'family_member']).sort()).toEqual(['desk', 'family']);
  });
});
