/**
 * The sponsor API (rule 2.9). It connects as tomoni_sponsor, which can read no table: every
 * answer comes from a sponsor.* function that returns suppressed, rounded aggregates. Feasibility
 * is throttled per sponsor (SECURITY "differencing").
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ErrorBody,
  Feasibility,
  FeasibilityBody,
  Funnel,
  SponsorTrials,
  SponsorUsage,
} from '@tomoni/contracts';
import { withScope } from '@tomoni/db';
import { requireAuth, SESSION_COOKIE } from '../auth/session';

const SPONSOR = requireAuth({ roles: ['sponsor_user'] });

export const sponsorRoutes: FastifyPluginAsyncZod = async (app) => {
  const q = <T>(
    req: { auth: { scope: Parameters<typeof withScope>[1] } | null },
    query: ReturnType<typeof sql>,
  ) =>
    withScope(
      'sponsor',
      req.auth!.scope,
      async (db) => (await db.execute<T & Record<string, unknown>>(query)).rows as T[],
    );

  app.get(
    '/sponsor-api/trials',
    { preHandler: SPONSOR, schema: { tags: ['sponsor'], response: { 200: SponsorTrials } } },
    async (req) =>
      (
        await q<{
          id: string;
          title: string;
          nct_id: string | null;
          therapeutic_area: string;
          status: string;
        }>(req, sql`SELECT * FROM sponsor.trials()`)
      ).map((t) => ({
        id: t.id,
        title: t.title,
        nctId: t.nct_id,
        therapeuticArea: t.therapeutic_area,
        status: t.status,
      })),
  );

  app.post(
    '/sponsor-api/feasibility',
    {
      preHandler: SPONSOR,
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 hour',
          // Per sponsor organisation, not per login, so a team can't multiply its budget.
          keyGenerator: (req) =>
            `feasibility:${req.auth?.scope.sponsorIds[0] ?? req.cookies[SESSION_COOKIE] ?? req.ip}`,
        },
      },
      schema: { tags: ['sponsor'], body: FeasibilityBody, response: { 200: Feasibility } },
    },
    async (req) =>
      (
        await q<{ f: Feasibility }>(
          req,
          sql`SELECT sponsor.feasibility(${JSON.stringify(req.body)}::jsonb) AS f`,
        )
      )[0]!.f,
  );

  app.get(
    '/sponsor-api/trials/:id/funnel',
    {
      preHandler: SPONSOR,
      schema: {
        tags: ['sponsor'],
        params: z.object({ id: z.uuid() }),
        response: { 200: Funnel, 404: ErrorBody },
      },
    },
    async (req, reply) => {
      const f = (await q<{ f: Funnel | null }>(req, sql`SELECT sponsor.funnel(${req.params.id}) AS f`))[0]!.f;
      return (
        f ?? reply.code(404).send({ error: 'not_found', message: 'No such trial for your organisation.' })
      );
    },
  );

  app.get(
    '/sponsor-api/usage',
    { preHandler: SPONSOR, schema: { tags: ['sponsor'], response: { 200: SponsorUsage } } },
    async (req) =>
      (
        await q<{ month: string; unit: string; units: string; amount_cents: string | null }>(
          req,
          sql`SELECT * FROM sponsor.usage()`,
        )
      ).map((u) => ({
        month: u.month,
        unit: u.unit,
        units: Number(u.units),
        amountCents: Number(u.amount_cents ?? 0),
      })),
  );
};
