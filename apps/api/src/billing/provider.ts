/**
 * Family subscription billing (Phase 4b, D-030). Stripe Checkout through its REST API, with
 * signed webhooks, and a labelled mock for the sandbox. Card details never touch Tomoni: the
 * family pays on the provider's page.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { realDataEnabled } from '@tomoni/db';

export type BillingEvent = {
  id: string;
  kind: 'activated' | 'renewed' | 'past_due' | 'canceled' | 'updated' | 'ignored';
  /** For 'updated': the provider's status mapped to ours, and the scheduled end (null = none). */
  status?: 'active' | 'past_due' | 'canceled' | undefined;
  cancelAt?: Date | null | undefined;
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
  /** A provider page where the family updates the card or cancels. */
  manage(o: { customerRef: string | null; householdId: string; returnUrl: string }): Promise<{ url: string }>;
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

// Stripe subscription statuses we act on; 'incomplete' and friends wait for checkout to finish.
const STRIPE_STATUS: Record<string, 'active' | 'past_due' | 'canceled'> = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'canceled',
  canceled: 'canceled',
  incomplete_expired: 'canceled',
};

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
      // Stripe Tax computes sales tax or GST once the account is registered (GO_LIVE_CHECKLIST).
      ...(process.env.TOMONI_STRIPE_AUTOMATIC_TAX === 'true' ? { 'automatic_tax[enabled]': 'true' } : {}),
    });
    const s = await this.post('checkout/sessions', body);
    if (!s.url.startsWith('https://checkout.stripe.com/')) throw new Error('stripe checkout: unexpected url');
    return { ref: s.id, url: s.url };
  }

  /** Stripe's customer portal: card update and cancel (at period end, as configured there). */
  async manage(c: { customerRef: string | null; returnUrl: string }) {
    if (!c.customerRef) throw new Error('stripe portal: no customer');
    const s = await this.post(
      'billing_portal/sessions',
      new URLSearchParams({ customer: c.customerRef, return_url: c.returnUrl }),
    );
    if (!s.url.startsWith('https://billing.stripe.com/')) throw new Error('stripe portal: unexpected url');
    return { url: s.url };
  }

  private async post(path: string, body: URLSearchParams) {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.o.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`stripe ${path}: HTTP ${res.status}`);
    const s = (await res.json()) as { id: string; url?: string };
    return { id: s.id, url: s.url ?? '' };
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
      case 'customer.subscription.updated': {
        const status = STRIPE_STATUS[str(o.status) ?? ''];
        if (!status) return { id: e.id, kind: 'ignored' };
        const at = typeof o.cancel_at === 'number' ? new Date(o.cancel_at * 1000) : null;
        return { id: e.id, kind: 'updated', subscriptionRef: o.id, status, cancelAt: at };
      }
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
  async manage(c: { householdId: string }) {
    return { url: `/family/billing/mock-manage?household=${c.householdId}` };
  }
  parseWebhook() {
    return null; // the mock has no webhook; its checkout page completes through /api/billing/mock/complete
  }
}

export const billingFromEnv = (env = process.env): BillingProvider =>
  env.TOMONI_ADAPTER_BILLING === 'real' ? new StripeBilling() : new MockBilling();
