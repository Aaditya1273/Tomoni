import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generate } from 'otplib';
import { sql } from 'drizzle-orm';
import { closePools, ownerDb, schema } from '@tomoni/db';
import { requireAuth } from '../src/auth/session';
import {
  backdateSessions,
  Client,
  makePracticeAndHousehold,
  makeUser,
  PASSWORD,
  testServer,
  totp,
} from './helpers';

let s: Awaited<ReturnType<typeof testServer>>;
let ids: Awaited<ReturnType<typeof makePracticeAndHousehold>>;

beforeAll(async () => {
  s = await testServer();
  // A route that needs full auth (MFA where required), to test the guard.
  s.app.get('/api/test/guarded', { preHandler: requireAuth() }, async () => ({ ok: true }));
  ids = await makePracticeAndHousehold();
});
afterAll(async () => {
  await s.app.close();
  await closePools();
});

const lastAudit = async (action: string) =>
  (
    await ownerDb()
      .select()
      .from(schema.auditEvent)
      .where(sql`action = ${action}`)
      .orderBy(sql`id DESC`)
      .limit(1)
  )[0];

describe('login', () => {
  it('family member: no MFA step, lands on family', async () => {
    const u = await makeUser('family_member', { householdId: ids.householdId });
    const c = new Client(s.app);
    const res = await c.login(u.email);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ next: 'none', surfaces: ['family'] });
    const me = await c.req('GET', '/api/me');
    expect(me.json().user.email).toBe(u.email);
    expect((await c.req('GET', '/api/test/guarded')).statusCode).toBe(200);
    expect((await lastAudit('login'))!.actorId).toBe(u.id);
  });

  it('session cookie is __Host-, httpOnly, Secure, SameSite=Strict; CSRF cookie is readable', async () => {
    const u = await makeUser('family_member', { householdId: ids.householdId });
    const res = await new Client(s.app).login(u.email);
    const sid = res.cookies.find((c) => c.name === '__Host-tomoni_sid')!;
    const csrf = res.cookies.find((c) => c.name === '__Host-tomoni_csrf')!;
    expect(sid).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    expect(csrf.httpOnly).toBeFalsy();
  });

  it('wrong password and unknown e-mail get the same generic 401, and are audited', async () => {
    const u = await makeUser('family_member', { householdId: ids.householdId });
    const a = await new Client(s.app).login(u.email, 'nope');
    const b = await new Client(s.app).login('nobody@test.local', 'nope');
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
    expect((await lastAudit('login_failed'))!.details).toEqual({ reason: 'unknown_account' });
  });

  it('locks the account after 5 failures, even with the right password', async () => {
    const u = await makeUser('family_member', { householdId: ids.householdId });
    const c = new Client(s.app);
    for (let i = 0; i < 5; i++) await c.login(u.email, 'wrong');
    expect((await c.login(u.email)).statusCode).toBe(401);
    expect((await lastAudit('login_failed'))!.details).toEqual({ reason: 'locked' });
  });

  it('rejects malformed bodies with 400', async () => {
    const res = await new Client(s.app).req('POST', '/api/auth/login', {
      email: 'not-an-email',
      password: 'x',
      extra: 1,
    });
    expect(res.statusCode).toBe(400);
  });

  const freshIp = () =>
    `10.${200 + (Date.now() % 50)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  it('rate-limits login to 10 per minute per (IP, account)', async () => {
    const c = new Client(s.app, freshIp());
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await c.login('x@test.local', 'y')).statusCode);
    expect(codes.slice(0, 10).every((x) => x === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    // A colleague on the same office IP is not locked out.
    expect((await c.login('colleague@test.local', 'y')).statusCode).toBe(401);
  });

  it('caps all logins from one IP at 60 per minute (account spraying)', async () => {
    const c = new Client(s.app, freshIp());
    const codes: number[] = [];
    for (let i = 0; i < 61; i++) codes.push((await c.login(`spray${i}@test.local`, 'y')).statusCode);
    expect(codes.slice(0, 60).every((x) => x === 401)).toBe(true);
    expect(codes[60]).toBe(429);
  });
});

describe('MFA (SECURITY S8)', () => {
  it('a nurse must enroll; until then data routes say mfa_required', async () => {
    const u = await makeUser('nurse', { practiceId: ids.practiceId });
    const c = new Client(s.app);
    expect((await c.login(u.email)).json().next).toBe('enroll');
    const g = await c.req('GET', '/api/test/guarded');
    expect(g.statusCode).toBe(403);
    expect(g.json().error).toBe('mfa_required');
  });

  it('enroll → confirm → guarded route works, session rotated, code cannot be replayed', async () => {
    const u = await makeUser('physician', { practiceId: ids.practiceId });
    const c = new Client(s.app);
    await c.login(u.email);
    const { secret } = (await c.req('POST', '/api/auth/mfa/enroll')).json();
    const oldSid = c.cookies.get('__Host-tomoni_sid');
    const code = await totp(secret);
    expect((await c.req('POST', '/api/auth/mfa/enroll/confirm', { code })).statusCode).toBe(204);
    expect(c.cookies.get('__Host-tomoni_sid')).not.toBe(oldSid);
    expect((await c.req('GET', '/api/test/guarded')).statusCode).toBe(200);

    // The pre-rotation session id is dead.
    const stale = new Client(s.app);
    stale.cookies.set('__Host-tomoni_sid', oldSid!);
    expect((await stale.req('GET', '/api/me')).statusCode).toBe(401);

    // Next login: same code is a replay → rejected; a later step's code works.
    const c2 = new Client(s.app);
    expect((await c2.login(u.email)).json().next).toBe('verify');
    expect((await c2.req('POST', '/api/auth/mfa/verify', { code })).statusCode).toBe(401);
    const next = await generate({ secret, epoch: Math.floor(Date.now() / 1000) + 30 });
    expect((await c2.req('POST', '/api/auth/mfa/verify', { code: next })).statusCode).toBe(204);
    expect((await c2.req('GET', '/api/test/guarded')).statusCode).toBe(200);
  });

  it('a wrong code fails', async () => {
    const u = await makeUser('ops_agent', { practiceId: ids.practiceId });
    const c = new Client(s.app);
    await c.login(u.email);
    await c.req('POST', '/api/auth/mfa/enroll');
    expect((await c.req('POST', '/api/auth/mfa/enroll/confirm', { code: '000000' })).statusCode).toBe(401);
  });
});

describe('sessions', () => {
  it('idle timeout: a staff session idle for 16 minutes is dead', async () => {
    const u = await makeUser('front_desk', { practiceId: ids.practiceId });
    const c = new Client(s.app);
    await c.login(u.email);
    expect((await c.req('GET', '/api/me')).statusCode).toBe(200);
    await backdateSessions(u.id, '16 minutes');
    expect((await c.req('GET', '/api/me')).statusCode).toBe(401);
  });

  it('family sessions survive a 16-minute gap', async () => {
    const u = await makeUser('family_member', { householdId: ids.householdId });
    const c = new Client(s.app);
    await c.login(u.email);
    await backdateSessions(u.id, '16 minutes');
    expect((await c.req('GET', '/api/me')).statusCode).toBe(200);
  });

  it('logout revokes the session', async () => {
    const u = await makeUser('family_member', { householdId: ids.householdId });
    const c = new Client(s.app);
    await c.login(u.email);
    const sid = c.cookies.get('__Host-tomoni_sid')!;
    expect((await c.req('POST', '/api/auth/logout')).statusCode).toBe(204);
    const again = new Client(s.app);
    again.cookies.set('__Host-tomoni_sid', sid);
    expect((await again.req('GET', '/api/me')).statusCode).toBe(401);
  });
});

describe('CSRF and Origin (SECURITY S9)', () => {
  it('state-changing request without the CSRF header is refused', async () => {
    const u = await makeUser('family_member', { householdId: ids.householdId });
    const c = new Client(s.app);
    await c.login(u.email);
    const res = await c.req('POST', '/api/auth/logout', undefined, { csrf: false });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('bad_csrf');
  });

  it('a foreign or missing Origin is refused, even for login', async () => {
    const c = new Client(s.app);
    expect(
      (
        await c.req(
          'POST',
          '/api/auth/login',
          { email: 'a@b.co', password: 'x' },
          { origin: 'https://evil.example' },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await c.req('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' }, { origin: null }))
        .statusCode,
    ).toBe(403);
  });
});

describe('PHI-free logs (SECURITY S13)', () => {
  it('passwords, e-mails, cookies and CSRF tokens never reach the log', async () => {
    const u = await makeUser('family_member', { householdId: ids.householdId });
    const c = new Client(s.app);
    await c.login(u.email);
    await c.req('GET', '/api/me?name=Raj%20Patel&phone=2015550101');
    await c.login(u.email, 'super-secret-wrong-pw');
    const log = s.logText();
    expect(log.length).toBeGreaterThan(0);
    for (const secret of [
      u.email,
      PASSWORD,
      'super-secret-wrong-pw',
      'Raj',
      '2015550101',
      c.cookies.get('__Host-tomoni_sid')!,
    ]) {
      expect(log).not.toContain(secret);
    }
  });

  it('logging a non-Error as err never throws, and is scrubbed too', () => {
    expect(() => s.app.log.warn({ err: 'call 732-555-0199 failed' }, 'x')).not.toThrow();
    expect(s.logText()).toContain('call [redacted] failed');
  });
});

describe('system', () => {
  it('reports sandbox mode and mocked adapters', async () => {
    const res = await new Client(s.app).req('GET', '/api/system/sandbox');
    expect(res.json()).toMatchObject({ sandbox: true, realDataEnabled: false });
  });
  it('serves OpenAPI at /docs', async () => {
    const res = await s.app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().paths)).toContain('/api/auth/login');
  });
});
