import { PassThrough } from 'node:stream';
import { sql } from 'drizzle-orm';
import { generate } from 'otplib';
import { ownerDb, schema } from '@tomoni/db';
import type { Role } from '@tomoni/core';
import { buildServer } from '../src/server';
import { hashPassword } from '../src/auth/password';

export const ORIGIN = 'http://localhost:3000';
export const PASSWORD = 'correct horse battery staple';

let n = 0;
/** Create a user with one role grant; returns its email. */
export async function makeUser(role: Role, scope: { practiceId?: string; householdId?: string } = {}) {
  const db = ownerDb();
  const email = `${role}.${Date.now()}.${n++}@test.local`;
  const [u] = await db
    .insert(schema.userAccount)
    .values({ email, displayName: role, passwordHash: await hashPassword(PASSWORD) })
    .returning();
  await db.insert(schema.roleGrant).values({
    userId: u!.id,
    role,
    practiceId: scope.practiceId ?? null,
    householdId: scope.householdId ?? null,
  });
  return { email, id: u!.id };
}

export async function makePracticeAndHousehold() {
  const db = ownerDb();
  const [p] = await db
    .insert(schema.practice)
    .values({ name: 'Test Practice', tz: 'America/New_York' })
    .returning();
  const [h] = await db
    .insert(schema.household)
    .values({ displayName: 'Test', primaryLocale: 'en' })
    .returning();
  return { practiceId: p!.id, householdId: h!.id };
}

export async function testServer() {
  const logs = new PassThrough();
  const chunks: string[] = [];
  logs.on('data', (c) => chunks.push(String(c)));
  const app = await buildServer({ logStream: logs, config: { allowedOrigins: [ORIGIN], docs: true } });
  return { app, logText: () => chunks.join('') };
}

/** A cookie jar over inject(): keeps session + CSRF cookies and sends the CSRF header. */
export class Client {
  cookies = new Map<string, string>();
  constructor(
    private app: Awaited<ReturnType<typeof testServer>>['app'],
    private ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  ) {}

  async req(
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
    opts: { csrf?: boolean; origin?: string | null } = {},
  ) {
    const headers: Record<string, string> = {};
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
    const csrf = this.cookies.get('__Host-tomoni_csrf');
    if (csrf && opts.csrf !== false) headers['x-csrf-token'] = csrf;
    const res = await this.app.inject({
      method,
      url,
      headers,
      remoteAddress: this.ip,
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    for (const c of res.cookies) {
      if (c.value === '' || (c.expires && c.expires.getTime() < Date.now())) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return res;
  }

  login(email: string, password = PASSWORD) {
    return this.req('POST', '/api/auth/login', { email, password });
  }
}

export const totp = (secret: string) => generate({ secret });

export async function backdateSessions(userId: string, by: string) {
  await ownerDb().execute(
    sql`UPDATE auth.session SET last_seen_at = now() - ${by}::interval WHERE user_id = ${userId}`,
  );
}
