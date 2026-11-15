import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  anonymousScope,
  absoluteLifetimeFor,
  idleTimeoutFor,
  requiresMfa,
  scopeFromGrants,
  surfacesFor,
} from '@tomoni/core';
import type { MfaStep } from '@tomoni/contracts';
import { ErrorBody, LoginBody, LoginResponse, Me, MfaCodeBody, MfaEnrollResponse } from '@tomoni/contracts';
import { audit, cipher, pool, withScope } from '@tomoni/db';
import { z } from 'zod';
import { verifyPassword } from './password';
import { newTotpSecret, totpUri, verifyTotp } from './totp';
import {
  clearSessionCookies,
  newToken,
  requireAuth,
  resolveSession,
  setSessionCookies,
  sha256,
  surfacesOf,
  type AuthContext,
} from './session';

const MFA_AAD = 'auth.user_account.mfa_secret';
const GENERIC = {
  error: 'invalid_credentials',
  message: 'Email or password is incorrect, or the account is locked.',
};

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/api/auth/login',
    {
      // Per (IP, account): a clinic's staff share one office IP, so a per-IP-only limit would lock
      // colleagues out of each other at 9am. Spraying many accounts from one IP is capped by the
      // per-IP limit registered in server.ts.
      config: {
        rateLimit: {
          max: Number(process.env.TOMONI_LOGIN_LIMIT ?? 10), // raised only by the e2e stack
          timeWindow: '1 minute',
          hook: 'preHandler', // after body parsing, so the key can include the e-mail
          keyGenerator: (req) =>
            `login:${req.ip}:${String((req.body as { email?: unknown } | undefined)?.email ?? '').toLowerCase()}`,
        },
      },
      schema: { tags: ['auth'], body: LoginBody, response: { 200: LoginResponse, 401: ErrorBody } },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const { rows } = await pool('app').query<{
        id: string;
        password_hash: string | null;
        mfa_enabled_at: Date | null;
        status: string;
        locked_until: Date | null;
      }>('SELECT * FROM auth.login_lookup($1)', [email]);
      const u = rows[0];
      const pwOk = await verifyPassword(u?.password_hash ?? null, password);
      const locked = u && (u.status !== 'active' || (u.locked_until && u.locked_until > new Date()));

      if (!u || !pwOk || locked) {
        if (u && !pwOk) await pool('app').query('SELECT auth.record_login_failure($1)', [u.id]);
        await withScope('app', anonymousScope(), (db) =>
          audit(db, {
            action: 'login_failed',
            entityType: 'user_account',
            entityId: u?.id ?? null,
            purpose: 'security',
            details: { reason: !u ? 'unknown_account' : locked ? 'locked' : 'bad_password' },
          }),
        );
        return reply.code(401).send(GENERIC);
      }

      await pool('app').query('SELECT auth.record_login_success($1)', [u.id]);
      const token = newToken();
      const csrf = newToken();
      const roles = await rolesOf(u.id);
      await pool('app').query('SELECT auth.session_create($1, $2, $3, $4, $5::interval, $6)', [
        sha256(token),
        u.id,
        sha256(csrf),
        idleTimeoutFor(roles),
        absoluteLifetimeFor(roles),
        req.headers['user-agent'] ?? null,
      ]);
      const ctx = (await resolveSession(token))!;
      await withScope('app', ctx.scope, (db) =>
        audit(db, { action: 'login', entityType: 'user_account', entityId: u.id, purpose: 'security' }),
      );
      setSessionCookies(reply, token, csrf);
      const next: z.infer<typeof MfaStep> = !requiresMfa(roles)
        ? 'none'
        : u.mfa_enabled_at
          ? 'verify'
          : 'enroll';
      return { next, surfaces: surfacesFor(roles) };
    },
  );

  app.post(
    '/api/auth/mfa/verify',
    {
      preHandler: requireAuth({ mfa: false }),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { tags: ['auth'], body: MfaCodeBody, response: { 204: z.null(), 401: ErrorBody } },
    },
    async (req, reply) => {
      const a = req.auth!;
      if (!(await checkCode(a, req.body.code, true))) {
        return reply
          .code(401)
          .send({ error: 'bad_code', message: 'That code did not match. Try the next one.' });
      }
      await rotate(a, reply);
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/api/auth/mfa/enroll',
    {
      preHandler: requireAuth({ mfa: false }),
      schema: { tags: ['auth'], response: { 200: MfaEnrollResponse, 409: ErrorBody } },
    },
    async (req, reply) => {
      const a = req.auth!;
      if (a.mfaEnabled)
        return reply.code(409).send({ error: 'already_enrolled', message: 'Already enrolled.' });
      const secret = newTotpSecret();
      await pool('app').query('SELECT auth.set_mfa_secret($1, $2)', [
        a.userId,
        cipher().encrypt(secret, MFA_AAD),
      ]);
      return { otpauthUri: totpUri(secret, a.email), secret };
    },
  );

  app.post(
    '/api/auth/mfa/enroll/confirm',
    {
      preHandler: requireAuth({ mfa: false }),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { tags: ['auth'], body: MfaCodeBody, response: { 204: z.null(), 401: ErrorBody } },
    },
    async (req, reply) => {
      const a = req.auth!;
      if (!(await checkCode(a, req.body.code, false))) {
        return reply
          .code(401)
          .send({ error: 'bad_code', message: 'That code did not match. Try the next one.' });
      }
      await pool('app').query('SELECT auth.enable_mfa($1)', [a.userId]);
      await withScope('app', a.scope, (db) =>
        audit(db, {
          action: 'mfa_enrolled',
          entityType: 'user_account',
          entityId: a.userId,
          purpose: 'security',
        }),
      );
      await rotate(a, reply);
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/api/auth/logout',
    { preHandler: requireAuth({ mfa: false }), schema: { tags: ['auth'], response: { 204: z.null() } } },
    async (req, reply) => {
      const a = req.auth!;
      await pool('app').query('SELECT auth.session_revoke($1)', [a.sessionHash]);
      await withScope('app', a.scope, (db) =>
        audit(db, { action: 'logout', entityType: 'user_account', entityId: a.userId, purpose: 'security' }),
      );
      clearSessionCookies(reply);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/api/me',
    { preHandler: requireAuth({ mfa: false }), schema: { tags: ['auth'], response: { 200: Me } } },
    async (req) => {
      const a = req.auth!;
      return {
        user: { id: a.userId, email: a.email, displayName: a.displayName },
        roles: a.roles,
        surfaces: surfacesOf(a),
        mfa: { required: a.mfaRequired, enabled: a.mfaEnabled, verified: a.mfaVerified },
      };
    },
  );
};

async function rolesOf(userId: string) {
  const { rows } = await pool('app').query<{ g: Parameters<typeof scopeFromGrants>[1] }>(
    'SELECT auth.user_grants($1) AS g',
    [userId],
  );
  return scopeFromGrants(userId, rows[0]!.g).roles;
}

async function checkCode(a: AuthContext, code: string, mustBeEnabled: boolean): Promise<boolean> {
  const { rows } = await pool('app').query<{
    mfa_secret: Buffer | null;
    mfa_enabled_at: Date | null;
    mfa_last_step: string | null;
  }>('SELECT * FROM auth.mfa_state($1)', [a.userId]);
  const s = rows[0];
  if (!s?.mfa_secret || (mustBeEnabled && !s.mfa_enabled_at)) return false;
  const step = await verifyTotp(
    cipher().decrypt(s.mfa_secret, MFA_AAD),
    code,
    s.mfa_last_step ? Number(s.mfa_last_step) : null,
  );
  if (step === null) return false;
  const claimed = await pool('app').query<{ ok: boolean }>('SELECT auth.claim_mfa_step($1, $2) AS ok', [
    a.userId,
    step,
  ]);
  return claimed.rows[0]!.ok;
}

/** New session id + CSRF token after MFA (session fixation defence). */
async function rotate(a: AuthContext, reply: Parameters<typeof setSessionCookies>[0]) {
  const token = newToken();
  const csrf = newToken();
  await pool('app').query('SELECT auth.session_rotate($1, $2, $3, true)', [
    a.sessionHash,
    sha256(token),
    sha256(csrf),
  ]);
  setSessionCookies(reply, token, csrf);
}
