import type { Role } from './roles';

export interface RoleGrant {
  role: Role;
  practiceId: string | null;
  householdId: string | null;
  patientId: string | null;
  sponsorId: string | null;
}

/**
 * Everything RLS needs to know about a request. Each role family keeps its own id list so a
 * user who is a nurse at one practice and a family member elsewhere never mixes the two.
 */
export interface RequestScope {
  actorKind: 'user' | 'system' | 'agent';
  actorId: string;
  userId: string | null;
  roles: Role[];
  isAdmin: boolean;
  staffRoles: Role[];
  staffPracticeIds: string[];
  opsPracticeIds: string[];
  householdIds: string[];
  patientIds: string[];
  sponsorIds: string[];
}

const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => x !== null))];

export function scopeFromGrants(userId: string, grants: readonly RoleGrant[]): RequestScope {
  const by = (...roles: Role[]) => grants.filter((g) => roles.includes(g.role));
  const staff = by('physician', 'nurse', 'front_desk');
  return {
    actorKind: 'user',
    actorId: userId,
    userId,
    roles: [...new Set(grants.map((g) => g.role))],
    isAdmin: grants.some((g) => g.role === 'admin'),
    staffRoles: [...new Set(staff.map((g) => g.role))],
    staffPracticeIds: uniq(staff.map((g) => g.practiceId)),
    opsPracticeIds: uniq(by('ops_agent').map((g) => g.practiceId)),
    householdIds: uniq(by('family_member').map((g) => g.householdId)),
    patientIds: uniq(by('patient', 'representative').map((g) => g.patientId)),
    sponsorIds: uniq(by('sponsor_user').map((g) => g.sponsorId)),
  };
}

/** A scope that sees nothing (pre-login requests). */
export function anonymousScope(): RequestScope {
  return {
    actorKind: 'user',
    actorId: 'anonymous',
    userId: null,
    roles: [],
    isAdmin: false,
    staffRoles: [],
    staffPracticeIds: [],
    opsPracticeIds: [],
    householdIds: [],
    patientIds: [],
    sponsorIds: [],
  };
}

/** Scope for a background job. Runs on the worker DB role; the id names the job in the audit log. */
export function systemScope(job: string): RequestScope {
  return { ...anonymousScope(), actorKind: 'system', actorId: `system:${job}` };
}
