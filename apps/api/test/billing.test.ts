import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { scopeFromGrants } from '@tomoni/core';
import { closePools, hashFor, ownerDb, schema, withScope } from '@tomoni/db';
import { MockLLM } from '@tomoni/voice';
import { StripeBilling, verifyStripeSignature } from '../src/billing/provider';
import { buildServer } from '../src/server';
import { Client, makePracticeAndHousehold, makeUser, ORIGIN } from './helpers';

const db = ownerDb();
const SECRET = 'whsec_test_secret';
let app: Awaited<ReturnType<typeof buildServer>>;
let stripeApp: Awaited<ReturnType<typeof buildServer>>;
let india: Awaited<ReturnType<typeof makePracticeAndHousehold>>;
let us: Awaited<ReturnType<typeof makePracticeAndHousehold>>;
let priya: Client;
let usFamily: Client;
let patientId = '';
let priyaId = '';

const family = async (householdId: string) => {
  const u = await makeUser('family_member', { householdId });
  const c = new Client(app);
  await c.login(u.email);
  return { c, id: u.id };
};
const sub = async (hh: string) =>
  (
    await db.execute<{ status: string; subscription_ref: string | null }>(
      sql`SELECT status, subscription_ref FROM care.subscription WHERE household_id = ${hh}`,
    )
  ).rows[0];
const callable = async () =>
  (await db.execute(sql`SELECT 1 FROM care.callable_patient WHERE id = ${patientId}`)).rows.length > 0;

beforeAll(async () => {
  app = await buildServer({ config: { allowedOrigins: [ORIGIN], docs: false }, llm: new MockLLM() });
  stripeApp = await buildServer({
    config: { allowedOrigins: [ORIGIN], docs: false },
    llm: new MockLLM(),
    billing: new StripeBilling({ secretKey: 'sk_test_x', priceId: 'price_x', webhookSecret: SECRET }),
  });
  india = await makePracticeAndHousehold();
  us = await makePracticeAndHousehold();
  await db.execute(sql`UPDATE care.household SET region = 'IN' WHERE id = ${india.householdId}`);
  const [p] = await db
    .insert(schema.patient)
    .values({
      practiceId: india.practiceId,
      householdId: india.householdId,
      name: 'Sunita Mehta',
      dob: '1952-03-01',
      birthYear: 1952,
      state: 'GJ',
      locale: 'hi',
      tz: 'Asia/Kolkata',
      medicareType: 'none',
    })
    .returning();
  patientId = p!.id;
  await db.insert(schema.contactConsent).values({
    patientId,
    channel: 'voice',
    phoneHash: hashFor.phone('+91-98765-43210'),
    recordingAllowed: false,
    givenByKind: 'patient',
    givenAt: new Date(),
  });
  const f = await family(india.householdId);
  priya = f.c;
  priyaId = f.id;
  usFamily = (await family(us.householdId)).c;
});
afterAll(async () => {
  await app.close();
  await stripeApp.close();
  await closePools();
});

describe('family plan, India bridge (D-030)', () => {
  it('US households are covered by the practice; nothing to buy', async () => {
    const r = await usFamily.req('POST', '/api/family/billing/checkout', { householdId: us.householdId });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('not_family_paid');
  });

  it('no plan, no scheduled calls; another family can neither start nor see it', async () => {
    expect((await priya.req('GET', '/api/family/billing')).json()).toEqual([
      expect.objectContaining({ householdId: india.householdId, region: 'IN', status: 'none' }),
    ]);
    expect(await callable()).toBe(false);
    const r = await usFamily.req('POST', '/api/family/billing/checkout', { householdId: india.householdId });
    expect(r.statusCode).toBe(403);
  });

  it('the family can open a checkout but never make itself active (RLS)', async () => {
    const r = await priya.req('POST', '/api/family/billing/checkout', { householdId: india.householdId });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().url).toMatch(/^\/family\/billing\/mock-checkout\?ref=mock_cs_/);
    expect(await sub(india.householdId)).toMatchObject({ status: 'pending' });
    const scope = scopeFromGrants(priyaId, [
      {
        role: 'family_member',
        practiceId: null,
        householdId: india.householdId,
        patientId: null,
        sponsorId: null,
      },
    ]);
    await expect(
      withScope('app', scope, (d) =>
        d.execute(
          sql`UPDATE care.subscription SET status = 'active' WHERE household_id = ${india.householdId}`,
        ),
      ),
    ).rejects.toSatisfy((e: Error) => /row-level security/.test(String((e.cause as Error)?.message)));
    expect(await callable()).toBe(false);
  });

  it('the mock checkout completes it once; calls start; other families get a 404', async () => {
    const ref = new URLSearchParams(
      (await priya.req('POST', '/api/family/billing/checkout', { householdId: india.householdId }))
        .json()
        .url.split('?')[1],
    ).get('ref')!;
    expect((await usFamily.req('POST', '/api/billing/mock/complete', { ref })).statusCode).toBe(404);
    expect((await priya.req('POST', '/api/billing/mock/complete', { ref })).statusCode).toBe(200);
    expect(await sub(india.householdId)).toMatchObject({ status: 'active' });
    expect(await callable()).toBe(true);
    expect((await priya.req('POST', '/api/billing/mock/complete', { ref })).statusCode).toBe(404);
    const again = await priya.req('POST', '/api/family/billing/checkout', { householdId: india.householdId });
    expect(again.statusCode).toBe(409);
  });

  it('the family cancels at period end; calls stop once it passes; another family cannot', async () => {
    const m = await priya.req('POST', '/api/family/billing/manage', { householdId: india.householdId });
    expect(m.json().url).toBe(`/family/billing/mock-manage?household=${india.householdId}`);
    expect(
      (
        await usFamily.req('POST', '/api/billing/mock/cancel', {
          householdId: india.householdId,
          cancel: true,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await priya.req('POST', '/api/billing/mock/cancel', { householdId: india.householdId, cancel: true }))
        .statusCode,
    ).toBe(200);
    const [plan] = (await priya.req('GET', '/api/family/billing')).json();
    expect(plan).toMatchObject({ status: 'active', cancelAt: expect.any(String) });
    expect(await callable()).toBe(true); // paid month still runs
    await db.execute(
      sql`UPDATE care.subscription SET cancel_at = now() - interval '1 minute' WHERE household_id = ${india.householdId}`,
    );
    expect(await callable()).toBe(false); // even if the provider's final event never arrives
    expect((await priya.req('GET', '/api/family/billing')).json()[0].status).toBe('canceled');
    await db.execute(
      sql`UPDATE care.subscription SET cancel_at = now() + interval '1 day' WHERE household_id = ${india.householdId}`,
    );
    await priya.req('POST', '/api/billing/mock/cancel', { householdId: india.householdId, cancel: false });
    expect((await priya.req('GET', '/api/family/billing')).json()[0]).toMatchObject({ cancelAt: null });
    expect(await callable()).toBe(true);
  });
});

describe('Stripe webhooks', () => {
  const hh = () => india.householdId;
  const signed = (event: object, t = Math.floor(Date.now() / 1000), secret = SECRET) => {
    const raw = JSON.stringify(event);
    const v1 = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
    return { raw, header: `t=${t},v1=${v1}` };
  };
  const post = (event: object, o: { t?: number; secret?: string } = {}) => {
    const { raw, header } = signed(event, o.t, o.secret);
    return stripeApp.inject({
      method: 'POST',
      url: '/api/billing/webhook/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': header },
      payload: raw,
    });
  };

  beforeAll(async () => {
    await db.execute(sql`UPDATE care.subscription SET status = 'pending', provider = 'stripe', checkout_ref = 'cs_test_1',
      subscription_ref = NULL, cancel_at = NULL, customer_ref = NULL, current_period_end = NULL WHERE household_id = ${hh()}`);
  });

  it('verifies signatures the way Stripe documents them', () => {
    const { raw, header } = signed({ a: 1 }, 1_800_000_000);
    expect(verifyStripeSignature(raw, header, SECRET, 1_800_000_000_000)).toBe(true);
    expect(verifyStripeSignature(`${raw} `, header, SECRET, 1_800_000_000_000)).toBe(false);
    expect(verifyStripeSignature(raw, header, SECRET, 1_800_000_400_000)).toBe(false); // > 5 min old
    expect(verifyStripeSignature(raw, undefined, SECRET)).toBe(false);
  });

  it("opens Stripe's portal for the customer, and only a Stripe-hosted one", async () => {
    const s = new StripeBilling({ secretKey: 'sk_test_x', priceId: 'price_x', webhookSecret: SECRET });
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (u: string, i: RequestInit) => {
      seen.push(`${u} ${String(i.body)}`);
      return Response.json({
        id: 'bps_1',
        url: seen.length === 1 ? 'https://billing.stripe.com/p/1' : 'https://evil.example/',
      });
    });
    try {
      const o = { customerRef: 'cus_1', householdId: hh(), returnUrl: 'https://app.example/family' };
      expect(await s.manage(o)).toEqual({ url: 'https://billing.stripe.com/p/1' });
      expect(seen[0]).toContain('/v1/billing_portal/sessions customer=cus_1');
      await expect(s.manage(o)).rejects.toThrow(/unexpected url/);
      await expect(s.manage({ ...o, customerRef: null })).rejects.toThrow(/no customer/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects a bad or stale signature without a session or CSRF token, and changes nothing', async () => {
    const e = {
      id: 'evt_bad',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', client_reference_id: hh(), subscription: 'sub_1' } },
    };
    expect((await post(e, { secret: 'whsec_wrong' })).statusCode).toBe(400);
    expect((await post(e, { t: Math.floor(Date.now() / 1000) - 600 })).statusCode).toBe(400);
    expect(await sub(hh())).toMatchObject({ status: 'pending' });
  });

  it('activates on checkout, applies each event once, then past-due and canceled', async () => {
    const done = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: { id: 'cs_test_1', client_reference_id: hh(), subscription: 'sub_1', customer: 'cus_1' },
      },
    };
    expect((await post(done)).json()).toEqual({ received: true, duplicate: false });
    expect(await sub(hh())).toMatchObject({ status: 'active', subscription_ref: 'sub_1' });
    expect((await post(done)).json()).toEqual({ received: true, duplicate: true });

    // A completed checkout for another household's session does nothing.
    await post({
      id: 'evt_x',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_other', client_reference_id: us.householdId, subscription: 'sub_x' } },
    });
    expect(await sub(us.householdId)).toBeUndefined();

    // A cancel from the portal: active until the paid period ends, then not dialed.
    const at = (s: number) => ({
      id: `evt_u${s}`,
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', cancel_at: Math.floor(Date.now() / 1000) + s } },
    });
    await post(at(86_400));
    expect(await callable()).toBe(true);
    await post(at(-60));
    expect(await callable()).toBe(false);
    await post({
      id: 'evt_u0',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', cancel_at: null } },
    });
    expect(await callable()).toBe(true);

    await post({
      id: 'evt_2',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_1', subscription: 'sub_1' } },
    });
    expect(await sub(hh())).toMatchObject({ status: 'past_due' });
    expect(await callable()).toBe(true); // grace through the retry window
    await post({ id: 'evt_3', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
    expect(await sub(hh())).toMatchObject({ status: 'canceled' });
    expect(await callable()).toBe(false);
    // A late or replayed update never revives a canceled plan.
    await post({
      id: 'evt_late',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', cancel_at: null } },
    });
    expect(await sub(hh())).toMatchObject({ status: 'canceled' });
    const audits = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM audit.event WHERE entity_type = 'subscription' AND entity_id = ${hh()}`,
    );
    expect(audits.rows[0]!.n).toBeGreaterThanOrEqual(5);
  });
});
