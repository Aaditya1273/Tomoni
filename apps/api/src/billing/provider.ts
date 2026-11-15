/**
 * Family subscription billing (Phase 4b, D-030). Stripe Checkout through its REST API, with
 * signed webhooks, and a labelled mock for the sandbox. Card details never touch Tomoni: the
 * family pays on the provider's page.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { realDataEnabled } from '@tomoni/db';

export type BillingEvent = {
  id: string;
  kind: 'activated' | 'renewed' | 'past_due' | 'canceled' | 'ignored';
  householdId?: string | undefined;
  checkoutRef?: string | undefined;
  subscriptionRef?: string | undefined;
  customerRef?: string | undefined;
  periodEnd?: Date | undefined;
};

export interface BillingProvider {
  readonly mode: 'stripe' | 'mock';
  createCheckout(o: {
    householdId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ ref: string; url: string }>;
  /** Null when the signature is missing, wrong or stale. */
  parseWebhook(raw: string, headers: Record<string, string | string[] | undefined>): BillingEvent | null;
}

const TOLERANCE_S = 300;

/** Stripe's scheme: `Stripe-Signature: t=<unix>,v1=<hex hmac-sha256 of "t.payload">`. */
export function verifyStripeSignature(
  raw: string,
  header: string | undefined,
  secret: string,
  now = Date.now(),
) {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > TOLERANCE_S) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${raw}`).digest();
  return parts.some(([k, v]) => {
    if (k !== 'v1' || !/^[0-9a-f]{64}$/.test(v)) return false;
    return timingSafeEqual(Buffer.from(v, 'hex'), expected);
  });
}

type StripeObject = Record<string, unknown> & { id: string };

export class StripeBilling implements BillingProvider {
  readonly mode = 'stripe';
  constructor(
    private o = {
      secretKey: process.env.TOMONI_STRIPE_SECRET_KEY ?? '',
      priceId: process.env.TOMONI_STRIPE_PRICE_ID ?? '',
      webhookSecret: process.env.TOMONI_STRIPE_WEBHOOK_SECRET ?? '',
    },
  ) {
    if (!o.secretKey || !o.priceId || !o.webhookSecret)
      throw new Error('Stripe billing needs TOMONI_STRIPE_SECRET_KEY, _PRICE_ID and _WEBHOOK_SECRET');
    if (o.secretKey.startsWith('sk_live_') && !realDataEnabled())
      throw new Error('Live Stripe keys need TOMONI_REAL_DATA_ENABLED=true');
  }

  async createCheckout(c: { householdId: string; successUrl: string; cancelUrl: string }) {
    const body = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': this.o.priceId,
      'line_items[0][quantity]': '1',
      success_url: c.successUrl,
      cancel_url: c.cancelUrl,
      client_reference_id: c.householdId,
      'subscription_data[metadata][household_id]': c.householdId,
    });
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.o.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`stripe checkout: HTTP ${res.status}`);
    const s = (await res.json()) as { id: string; url: string };
    if (!s.url?.startsWith('https://checkout.stripe.com/'))
      throw new Error('stripe checkout: unexpected url');
    return { ref: s.id, url: s.url };
  }

  parseWebhook(raw: string, headers: Record<string, string | string[] | undefined>): BillingEvent | null {
    const sig = headers['stripe-signature'];
    if (!verifyStripeSignature(raw, typeof sig === 'string' ? sig : undefined, this.o.webhookSecret))
      return null;
    const e = JSON.parse(raw) as { id: string; type: string; data: { object: StripeObject } };
    const o = e.data.object;
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    switch (e.type) {
      case 'checkout.session.completed':
        return {
          id: e.id,
          kind: 'activated',
          householdId: str(o.client_reference_id),
          checkoutRef: o.id,
          subscriptionRef: str(o.subscription),
          customerRef: str(o.customer),
        };
      case 'invoice.paid': {
        const end = (o.lines as { data?: { period?: { end?: number } }[] } | undefined)?.data?.[0]?.period
          ?.end;
        return {
          id: e.id,
          kind: 'renewed',
          subscriptionRef: str(o.subscription),
          ...(end ? { periodEnd: new Date(end * 1000) } : {}),
        };
      }
      case 'invoice.payment_failed':
        return { id: e.id, kind: 'past_due', subscriptionRef: str(o.subscription) };
      case 'customer.subscription.deleted':
        return { id: e.id, kind: 'canceled', subscriptionRef: o.id };
      default:
        return { id: e.id, kind: 'ignored' };
    }
  }
}

/** Sandbox only: checkout is a Tomoni page that says it is a mock; no money moves. */
export class MockBilling implements BillingProvider {
  readonly mode = 'mock';
  async createCheckout(c: { householdId: string; successUrl: string; cancelUrl: string }) {
    const ref = `mock_cs_${randomUUID()}`;
    const q = new URLSearchParams({ ref, success: c.successUrl, cancel: c.cancelUrl });
    return { ref, url: `/family/billing/mock-checkout?${q}` };
  }
  parseWebhook() {
    return null; // the mock has no webhook; its checkout page completes through /api/billing/mock/complete
  }
}

export const billingFromEnv = (env = process.env): BillingProvider =>
  env.TOMONI_ADAPTER_BILLING === 'real' ? new StripeBilling() : new MockBilling();
