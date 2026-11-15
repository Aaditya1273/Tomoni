/**
 * Agent actions: families ask Tomoni to help with a warning, families and doctors decide, ops
 * picks up what the agent could not finish (BUILD_PROMPT §5.3, rules 2.2–2.3). Actions are
 * proposed by the system on the worker role; people only ever decide, through care.approval,
 * whose trigger checks the approver's role in the database.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Queue } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ActionList, DecisionBody, ErrorBody } from '@tomoni/contracts';
import { systemScope, type Role } from '@tomoni/core';
import { audit, schema, withScope } from '@tomoni/db';
import { proposeForWarning } from '@tomoni/agent';
import { requireAuth } from '../auth/session';
import { actionItems } from './view';

const FAMILY: Role[] = ['family_member', 'patient', 'representative'];
const agent = systemScope('agent');

export const actionRoutes =
  (deps: { queue: Queue }): FastifyPluginAsyncZod =>
  async (app) => {
    const run = (ids: string[]) =>
      Promise.all(
        ids.map((actionId) =>
          deps.queue.add('action.run', { actionId }, { jobId: `run-${actionId}-${Date.now()}` }),
        ),
      );

    app.post(
      '/api/warnings/:id/help',
      {
        preHandler: requireAuth({ roles: FAMILY }),
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        schema: {
          tags: ['family'],
          params: z.object({ id: z.uuid() }),
          response: { 200: z.object({ proposed: z.number() }), 404: ErrorBody },
        },
      },
      async (req, reply) => {
        // Visibility is checked with the caller's own scope; the proposal itself is the system's.
        const visible = await withScope(
          'app',
          req.auth!.scope,
          async (db) =>
            (
              await db
                .select({ id: schema.warning.id })
                .from(schema.warning)
                .where(eq(schema.warning.id, req.params.id))
            ).length > 0,
        );
        if (!visible) return reply.code(404).send({ error: 'not_found', message: 'No such warning.' });
        const proposed = await withScope('worker', agent, (db) =>
          proposeForWarning(db, req.params.id, 'family_app'),
        );
        await run(proposed.filter((p) => p.created && p.state === 'approved').map((p) => p.id));
        return { proposed: proposed.length };
      },
    );

    app.post(
      '/api/actions/:id/decision',
      {
        preHandler: requireAuth({ roles: [...FAMILY, 'physician'] }),
        schema: {
          tags: ['family', 'desk'],
          params: z.object({ id: z.uuid() }),
          body: DecisionBody,
          response: { 204: z.null(), 403: ErrorBody, 404: ErrorBody },
        },
      },
      async (req, reply) => {
        const a = req.auth!;
        const result = await withScope('app', a.scope, async (db) => {
          const [act] = await db.select().from(schema.action).where(eq(schema.action.id, req.params.id));
          if (!act) return 'not_found' as const;
          // Which of the caller's roles fits this action; the database trigger checks it again.
          const role =
            act.approvalClass === 'physician'
              ? a.roles.find((r) => r === 'physician')
              : act.approvalClass === 'family'
                ? a.roles.find((r) => FAMILY.includes(r))
                : undefined;
          if (!role || act.state !== 'awaiting_approval') return 'forbidden' as const;
          await db.insert(schema.approval).values({
            actionId: act.id,
            approverUserId: a.userId,
            approverRole: role,
            decision: req.body.decision,
            reason: req.body.reason ?? null,
          });
          await audit(db, {
            action: 'approval',
            entityType: 'action',
            entityId: act.id,
            patientId: act.patientId,
            purpose: 'treatment',
            details: { decision: req.body.decision, role, skill: act.skill },
          });
          return req.body.decision;
        }).catch(() => 'forbidden' as const);
        if (result === 'not_found')
          return reply.code(404).send({ error: 'not_found', message: 'No such action.' });
        if (result === 'forbidden')
          return reply.code(403).send({ error: 'forbidden', message: 'You cannot decide this action.' });
        if (result === 'approve') await run([req.params.id]);
        return reply.code(204).send(null);
      },
    );

    app.get(
      '/api/desk/approvals',
      {
        preHandler: requireAuth({ roles: ['physician', 'nurse', 'front_desk'] }),
        schema: { tags: ['desk'], response: { 200: ActionList } },
      },
      async (req) => {
        const s = req.auth!.scope;
        return withScope('app', s, async (db) => {
          const items = await actionItems(
            db,
            sql`a.state = 'awaiting_approval' AND a.approval_class = 'physician'
                AND a.patient_id IN (SELECT id FROM care.patient WHERE practice_id = ANY(${sql.param(s.staffPracticeIds)}::uuid[]))`,
          );
          return withNames(db, items);
        });
      },
    );

    app.get(
      '/api/ops/handoffs',
      {
        preHandler: requireAuth({ roles: ['ops_agent', 'admin'] }),
        schema: { tags: ['ops'], response: { 200: ActionList } },
      },
      async (req) =>
        withScope('app', req.auth!.scope, async (db) => {
          const items = await actionItems(db, sql`a.state = 'handoff'`);
          for (const i of items)
            await audit(db, {
              action: 'read',
              entityType: 'action',
              entityId: i.id,
              patientId: i.patientId,
              purpose: 'support',
            });
          return withNames(db, items);
        }),
    );

    app.post(
      '/api/ops/actions/:id/:verb',
      {
        preHandler: requireAuth({ roles: ['ops_agent', 'admin'] }),
        schema: {
          tags: ['ops'],
          params: z.object({ id: z.uuid(), verb: z.enum(['retry', 'cancel']) }),
          response: { 204: z.null(), 404: ErrorBody },
        },
      },
      async (req, reply) => {
        const state = req.params.verb === 'retry' ? 'approved' : 'cancelled';
        const ok = await withScope('app', req.auth!.scope, async (db) => {
          const [row] = await db
            .update(schema.action)
            .set({ state, handoffReason: null })
            .where(sql`id = ${req.params.id} AND state = 'handoff'`)
            .returning({ id: schema.action.id, patientId: schema.action.patientId });
          if (row)
            await audit(db, {
              action: 'update',
              entityType: 'action',
              entityId: row.id,
              patientId: row.patientId,
              purpose: 'support',
              details: { verb: req.params.verb },
            });
          return !!row;
        });
        if (!ok)
          return reply
            .code(404)
            .send({ error: 'not_found', message: 'No action waiting for ops with that id.' });
        if (state === 'approved') await run([req.params.id]);
        return reply.code(204).send(null);
      },
    );
  };

async function withNames(
  db: Parameters<Parameters<typeof withScope>[2]>[0],
  items: Awaited<ReturnType<typeof actionItems>>,
) {
  if (!items.length) return [];
  const people = await db
    .select({ id: schema.patient.id, name: schema.patient.name })
    .from(schema.patient)
    .where(sql`id = ANY(${sql.param([...new Set(items.map((i) => i.patientId))])}::uuid[])`);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  return items.map((i) => ({ ...i, patientName: nameOf.get(i.patientId) ?? '' }));
}
