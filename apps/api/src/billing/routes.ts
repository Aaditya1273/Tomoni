/**
 * Family subscription routes (Phase 4b, D-030). The family starts a checkout for a household in
 * India; only a verified provider event activates it (RLS: the care role can never write
 * 'active'). Events are applied once, by provider event id.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { systemScope } from '@tomoni/core';
import { BillingStatus, ErrorBody } from '@tomoni/contracts';
import { audit, withScope, type Db } from '@tomoni/db';
import { requireAuth } from '../auth/session';
import { billingFromEnv, type BillingEvent, type BillingProvider } from './provider';

const FAMILY = requireAuth({ roles: ['family_member', 'representative'] });
const PLAN = 'family_daily_v1';
const price = () => ({
  cents: Number(process.env.TOMONI_FAMILY_PLAN_CENTS ?? 2900),
  currency: 'USD' as const,
});

/** Applies one provider event. Returns false when it was already applied. */
export async function applyBillingEvent(db: Db, provider: 'stripe' | 'mock', e: BillingEvent) {
  const { rows } = await db.execute(sql`INSERT INTO care.billing_event (provider, event_id, kind)
    VALUES (${provider}, ${e.id}, ${e.kind}) ON CONFLICT DO NOTHING RETURNING 1`);
  if (!rows.length) return false;
  const period = e.periodEnd ? e.periodEnd.toISOString() : null;
  const changed =
    e.kind === 'activated' && e.householdId && e.checkoutRef
      ? await db.execute<{ household_id: string }>(sql`UPDATE care.subscription
          SET status = 'active', subscription_ref = ${e.subscriptionRef ?? null}, customer_ref = ${e.customerRef ?? null},
              current_period_end = coalesce(${period}::timestamptz, current_period_end), updated_at = now()
          WHERE household_id = ${e.householdId} AND checkout_ref = ${e.checkoutRef} AND provider = ${provider}
            AND status = 'pending' RETURNING household_id`)
      : e.kind !== 'ignored' && e.subscriptionRef
        ? await db.execute<{ household_id: string }>(sql`UPDATE care.subscription
            SET status = ${e.kind === 'renewed' ? 'active' : e.kind},
                current_period_end = coalesce(${period}::timestamptz, current_period_end), updated_at = now()
            WHERE subscription_ref = ${e.subscriptionRef} AND provider = ${provider}
              AND (${e.kind} <> 'past_due' OR status = 'active') RETURNING household_id`)
        : { rows: [] };
  for (const r of changed.rows)
    await audit(db, {
      action: 'update',
      entityType: 'subscription',
      entityId: r.household_id,
      patientId: null,
      purpose: 'payment',
      details: { event: e.kind, provider },
    });
  return true;
}

export const billingRoutes =
  (deps: {
    publicOrigin: string;
    provider?: BillingProvider;
    mockCheckout: boolean;
  }): FastifyPluginAsyncZod =>
  async (app) => {
    const provider = deps.provider ?? billingFromEnv();

    app.get(
      '/api/family/billing',
      { preHandler: FAMILY, schema: { tags: ['family'], response: { 200: z.array(BillingStatus) } } },
      async (req) =>
        withScope('app', req.auth!.scope, async (db) => {
          const { rows } = await db.execute<z.infer<typeof BillingStatus>>(sql`
            SELECT h.id AS "householdId", h.region, coalesce(s.status, 'none') AS status,
                   s.current_period_end::text AS "periodEnd"
              FROM care.household h LEFT JOIN care.subscription s ON s.household_id = h.id
             WHERE h.id = ANY(${sql.param(req.auth!.scope.householdIds)}::uuid[]) ORDER BY h.created_at`);
          return rows.map((r) => ({ ...r, price: price() }));
        }),
    );

    app.post(
      '/api/family/billing/checkout',
      {
        preHandler: FAMILY,
        config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
        schema: {
          tags: ['family'],
          body: z.strictObject({ householdId: z.uuid() }),
          response: { 200: z.object({ url: z.string() }), 400: ErrorBody, 403: ErrorBody, 409: ErrorBody },
        },
      },
      async (req, reply) => {
        const a = req.auth!;
        const { householdId } = req.body;
        if (!a.scope.householdIds.includes(householdId))
          return reply.code(403).send({ error: 'forbidden', message: 'Not your household.' });
        const state = await withScope('app', a.scope, async (db) => {
          const { rows } = await db.execute<{ region: string; status: string | null }>(sql`
            SELECT h.region, s.status FROM care.household h LEFT JOIN care.subscription s ON s.household_id = h.id
             WHERE h.id = ${householdId}`);
          return rows[0];
        });
        // US households are paid for by the practice (APCM); only the India bridge is family-paid.
        if (state?.region !== 'IN')
          return reply
            .code(400)
            .send({ error: 'not_family_paid', message: 'Your parent’s practice covers the calls.' });
        if (state.status === 'active' || state.status === 'past_due')
          return reply.code(409).send({ error: 'already_subscribed', message: 'The plan is already on.' });
        const back = deps.mockCheckout ? '' : deps.publicOrigin;
        const c = await provider.createCheckout({
          householdId,
          successUrl: `${back}/family?billing=done`,
          cancelUrl: `${back}/family?billing=canceled`,
        });
        await withScope('app', a.scope, async (db) => {
          await db.execute(sql`INSERT INTO care.subscription (household_id, plan_code, status, provider, checkout_ref, started_by)
            VALUES (${householdId}, ${PLAN}, 'pending', ${provider.mode}, ${c.ref}, ${a.userId})
            ON CONFLICT (household_id) DO UPDATE SET status = 'pending', provider = EXCLUDED.provider,
              checkout_ref = EXCLUDED.checkout_ref, started_by = EXCLUDED.started_by, subscription_ref = NULL,
              customer_ref = NULL, current_period_end = NULL, updated_at = now()`);
          await audit(db, {
            action: 'create',
            entityType: 'subscription',
            entityId: householdId,
            patientId: null,
            purpose: 'payment',
            details: { event: 'checkout_started', provider: provider.mode },
          });
        });
        return { url: c.url };
      },
    );

    // Signed by the provider, not the browser: no session, no CSRF (session.ts exempts this path).
    await app.register(async (hook) => {
      hook.addContentTypeParser(
        'application/json',
        { parseAs: 'string', bodyLimit: 256 * 1024 },
        (_r, b, done) => done(null, b),
      );
      hook.post(
        '/api/billing/webhook/stripe',
        { config: { rateLimit: { max: 600, timeWindow: '1 minute' } }, schema: { hide: true } },
        async (req, reply) => {
          if (provider.mode !== 'stripe') return reply.code(404).send({ error: 'not_found' });
          const e = provider.parseWebhook(req.body as string, req.headers);
          if (!e) return reply.code(400).send({ error: 'bad_signature' });
          const fresh = await withScope('worker', systemScope('billing.webhook'), (db) =>
            applyBillingEvent(db, 'stripe', e),
          );
          return { received: true, duplicate: !fresh };
        },
      );
    });

    // The mock checkout page completes here. Never registered in production (server.ts).
    if (deps.mockCheckout && provider.mode === 'mock')
      app.post(
        '/api/billing/mock/complete',
        {
          preHandler: FAMILY,
          schema: {
            tags: ['family'],
            body: z.strictObject({ ref: z.string().regex(/^mock_cs_[0-9a-f-]{36}$/) }),
            response: { 200: z.object({ ok: z.boolean() }), 404: ErrorBody },
          },
        },
        async (req, reply) => {
          const hh = await withScope('app', req.auth!.scope, async (db) => {
            const { rows } = await db.execute<{
              household_id: string;
            }>(sql`SELECT household_id FROM care.subscription
              WHERE checkout_ref = ${req.body.ref} AND status = 'pending'`);
            return rows[0]?.household_id;
          });
          if (!hh) return reply.code(404).send({ error: 'not_found', message: 'No such checkout.' });
          await withScope('worker', systemScope('billing.mock'), (db) =>
            applyBillingEvent(db, 'mock', {
              id: `mock_evt_${req.body.ref}`,
              kind: 'activated',
              householdId: hh,
              checkoutRef: req.body.ref,
              subscriptionRef: `mock_sub_${randomUUID()}`,
              periodEnd: new Date(Date.now() + 30 * 86_400_000),
            }),
          );
          return { ok: true };
        },
      );
  };
