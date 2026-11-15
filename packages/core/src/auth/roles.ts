export const ROLES = [
  'patient',
  'family_member',
  'representative',
  'physician',
  'nurse',
  'front_desk',
  'ops_agent',
  'sponsor_user',
  'admin',
] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES = ['physician', 'nurse', 'front_desk'] as const satisfies readonly Role[];
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles that must pass TOTP before any data access (SECURITY S8). */
export const MFA_REQUIRED_ROLES: readonly Role[] = [...STAFF_ROLES, 'ops_agent', 'sponsor_user', 'admin'];

/** Idle timeout in seconds: 15 min for clinical/ops/sponsor/admin, 7 days for family-side roles. */
export function idleTimeoutFor(roles: readonly Role[]): number {
  return roles.some((r) => MFA_REQUIRED_ROLES.includes(r)) ? 15 * 60 : 7 * 24 * 3600;
}

/** Absolute session lifetime: 12 h for MFA roles, 30 days otherwise. */
export function absoluteLifetimeFor(roles: readonly Role[]): string {
  return roles.some((r) => MFA_REQUIRED_ROLES.includes(r)) ? '12 hours' : '30 days';
}

export function requiresMfa(roles: readonly Role[]): boolean {
  return roles.some((r) => MFA_REQUIRED_ROLES.includes(r));
}

/** Which app surface a user lands on after login. */
export type Surface = 'family' | 'desk' | 'ops' | 'sponsor' | 'admin';
export function surfacesFor(roles: readonly Role[]): Surface[] {
  const s = new Set<Surface>();
  for (const r of roles) {
    if (r === 'patient' || r === 'family_member' || r === 'representative') s.add('family');
    else if (r === 'physician' || r === 'nurse' || r === 'front_desk') s.add('desk');
    else if (r === 'ops_agent') s.add('ops');
    else if (r === 'sponsor_user') s.add('sponsor');
    else if (r === 'admin') s.add('admin');
  }
  return [...s];
}
