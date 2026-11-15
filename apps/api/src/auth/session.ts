import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '@tomoni/db';
import { requiresMfa, scopeFromGrants, surfacesFor, type RequestScope, type Role, type RoleGrant } from '@tomoni/core';

export const SESSION_COOKIE = '__Host-tomoni_sid';
export const CSRF_COOKIE = '__Host-tomoni_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export interface AuthContext {
  sessionHash: Buffer;
  userId: string;
  email: string;
  displayName: string;
  roles: Role[];
  scope: RequestScope;
  mfaRequired: boolean;
  mfaEnabled: boolean;
  mfaVerified: boolean;
  csrfHash: Buffer;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest();

export async function resolveSession(token: string): Promise<AuthContext | null> {
  const idHash = sha256(token);
  const { rows } = await pool('app').query<{
    user_id: string;
    email: string;
    display_name: string;
    csrf_token_hash: Buffer;
    mfa_verified: boolean;
    mfa_enabled: boolean;
    grants: RoleGrant[];
  }>('SELECT * FROM auth.session_resolve($1)', [idHash]);
  const r = rows[0];
  if (!r) return null;
  const scope = scopeFromGrants(r.user_id, r.grants);
  return {
    sessionHash: idHash,
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name,
    roles: scope.roles,
    scope,
    mfaRequired: requiresMfa(scope.roles),
    mfaEnabled: r.mfa_enabled,
    mfaVerified: r.mfa_verified,
    csrfHash: r.csrf_token_hash,
  };
}

export function setSessionCookies(reply: FastifyReply, token: string, csrf: string): void {
  const base = { path: '/', secure: true, sameSite: 'strict' as const };
  reply.setCookie(SESSION_COOKIE, token, { ...base, httpOnly: true });
  reply.setCookie(CSRF_COOKIE, csrf, { ...base, httpOnly: false });
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', secure: true, sameSite: 'strict' });
  reply.clearCookie(CSRF_COOKIE, { path: '/', secure: true, sameSite: 'strict' });
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Session resolution + CSRF/Origin enforcement on every request. */
export async function sessionPlugin(app: FastifyInstance, opts: { allowedOrigins: string[] }) {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    req.auth = token ? await resolveSession(token) : null;

    if (!UNSAFE.has(req.method) || req.url.startsWith('/api/voice/')) return; // voice webhooks: signature-checked (Phase 3)
    const origin = req.headers.origin;
    if (!origin || !opts.allowedOrigins.includes(origin)) {
      return reply.code(403).send({ error: 'bad_origin', message: 'Request origin not allowed.' });
    }
    if (req.auth) {
      const header = req.headers[CSRF_HEADER];
      const got = typeof header === 'string' ? sha256(header) : null;
      if (!got || !timingSafeEqual(got, req.auth.csrfHash)) {
        return reply.code(403).send({ error: 'bad_csrf', message: 'Missing or invalid CSRF token.' });
      }
    }
  });
}

/**
 * Route guard. By default a session must exist and, for roles that require it, have passed MFA.
 * `roles` narrows further (any one of them).
 */
export function requireAuth(opts: { mfa?: boolean; roles?: Role[] } = {}) {
  const needMfa = opts.mfa ?? true;
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const a = req.auth;
    if (!a) return reply.code(401).send({ error: 'unauthenticated', message: 'Please sign in.' });
    if (needMfa && a.mfaRequired && !a.mfaVerified) {
      return reply.code(403).send({ error: 'mfa_required', message: 'Two-step verification required.' });
    }
    if (opts.roles && !a.roles.some((r) => opts.roles!.includes(r))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Not allowed for your role.' });
    }
  };
}

export const surfacesOf = (a: AuthContext) => surfacesFor(a.roles);
