/** Care desk: patients, nurse flags, and the call simulator (dev and staging only, §5.4). */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  DeskPatients,
  ErrorBody,
  NurseFlags,
  ResolveFlagBody,
  SimStartBody,
  SimTurnBody,
  SimTurnResult,
} from '@tomoni/contracts';
import { audit, schema, withScope } from '@tomoni/db';
import { llmFromEnv, type ConversationLLM } from '@tomoni/voice';
import type { Queue } from 'bullmq';
import { systemScope } from '@tomoni/core';
import { proposeForWarning } from '@tomoni/agent';
import { requireAuth, type AuthContext } from '../auth/session';
import { beginCall, CallError, callTurn } from './service';

const STAFF = ['physician', 'nurse', 'front_desk'] as const;
const STATUS: Record<CallError['code'], number> = {
  not_found: 404,
  no_contact_consent: 409,
  ended: 409,
  busy: 409,
};

export const callRoutes =
  (deps: { llm?: ConversationLLM; simulator: boolean; queue?: Queue }): FastifyPluginAsyncZod =>
  async (app) => {
    const llm = deps.llm ?? llmFromEnv();
    const staff = requireAuth({ roles: [...STAFF] });
    const fail = (e: unknown) => {
      if (e instanceof CallError)
        return { status: STATUS[e.code], body: { error: e.code, message: e.message } };
      throw e;
    };

    app.get(
      '/api/desk/patients',
      { preHandler: staff, schema: { tags: ['desk'], response: { 200: DeskPatients } } },
      async (req) => {
        const s = req.auth!.scope;
        return withScope('app', s, async (db) => {
          const rows = await db
            .select({
              id: schema.patient.id,
              name: schema.patient.name,
              locale: schema.patient.locale,
            })
            .from(schema.patient)
            .where(
              and(
                inArray(schema.patient.practiceId, s.staffPracticeIds),
                eq(schema.patient.status, 'active'),
              ),
            )
            .limit(1000);
          await audit(db, {
            action: 'read',
            entityType: 'patient_list',
            purpose: 'treatment',
            details: { n: rows.length },
          });
          return rows.sort((a, b) => a.name.localeCompare(b.name));
        });
      },
    );

    app.get(
      '/api/desk/flags',
      { preHandler: staff, schema: { tags: ['desk'], response: { 200: NurseFlags } } },
      async (req) => {
        const s = req.auth!.scope;
        return withScope('app', s, async (db) => {
          const rows = await db
            .select({
              f: schema.nurseFlag,
              name: schema.patient.name,
              preferred: schema.patient.preferredName,
            })
            .from(schema.nurseFlag)
            .innerJoin(schema.patient, eq(schema.patient.id, schema.nurseFlag.patientId))
            .where(
              and(
                inArray(schema.patient.practiceId, s.staffPracticeIds),
                ne(schema.nurseFlag.status, 'resolved'),
              ),
            )
            .orderBy(schema.nurseFlag.urgency, desc(schema.nurseFlag.createdAt))
            .limit(200);
          for (const r of rows)
            await audit(db, {
              action: 'read',
              entityType: 'nurse_flag',
              entityId: r.f.id,
              patientId: r.f.patientId,
              purpose: 'treatment',
            });
          return rows.map(({ f, name }) => ({
            id: f.id,
            patientId: f.patientId,
            patientName: name,
            class: f.class,
            urgency: f.urgency,
            status: f.status,
            excerpt: f.excerpt,
            matchedRule: f.matchedRule,
            channel: f.channel,
            callId: f.callId,
            createdAt: f.createdAt.toISOString(),
            acknowledgedAt: f.acknowledgedAt?.toISOString() ?? null,
          }));
        });
      },
    );

    const flagUpdate =
      (status: 'acknowledged' | 'resolved') =>
      async (req: { auth: AuthContext; params: { id: string }; body?: { note: string } }) =>
        withScope('app', req.auth.scope, async (db) => {
          const [row] = await db
            .update(schema.nurseFlag)
            .set(
              status === 'acknowledged'
                ? {
                    status,
                    acknowledgedAt: sql`coalesce(acknowledged_at, now())`,
                    assignedTo: req.auth.userId,
                  }
                : {
                    status,
                    resolvedAt: sql`now()`,
                    acknowledgedAt: sql`coalesce(acknowledged_at, now())`,
                    resolutionNote: req.body!.note,
                  },
            )
            .where(and(eq(schema.nurseFlag.id, req.params.id), ne(schema.nurseFlag.status, 'resolved')))
            .returning({ id: schema.nurseFlag.id, patientId: schema.nurseFlag.patientId });
          if (!row) return false;
          const [p] = await db
            .select({ practiceId: schema.patient.practiceId })
            .from(schema.patient)
            .where(eq(schema.patient.id, row.patientId));
          await db.insert(schema.outbox).values({
            topic: `flag.${status}`,
            aggregateType: 'nurse_flag',
            aggregateId: row.id,
            practiceId: p!.practiceId,
            payload: {},
          });
          await audit(db, {
            action: 'update',
            entityType: 'nurse_flag',
            entityId: row.id,
            patientId: row.patientId,
            purpose: 'treatment',
            details: { status },
          });
          return true;
        });

    app.post(
      '/api/desk/flags/:id/acknowledge',
      {
        preHandler: staff,
        schema: {
          tags: ['desk'],
          params: z.object({ id: z.uuid() }),
          response: { 204: z.null(), 404: ErrorBody },
        },
      },
      async (req, reply) =>
        (await flagUpdate('acknowledged')({ auth: req.auth!, params: req.params }))
          ? reply.code(204).send(null)
          : reply.code(404).send({ error: 'not_found', message: 'No open flag with that id.' }),
    );
    app.post(
      '/api/desk/flags/:id/resolve',
      {
        preHandler: staff,
        schema: {
          tags: ['desk'],
          params: z.object({ id: z.uuid() }),
          body: ResolveFlagBody,
          response: { 204: z.null(), 404: ErrorBody },
        },
      },
      async (req, reply) =>
        (await flagUpdate('resolved')({ auth: req.auth!, params: req.params, body: req.body }))
          ? reply.code(204).send(null)
          : reply.code(404).send({ error: 'not_found', message: 'No open flag with that id.' }),
    );

    if (!deps.simulator) return;

    app.post(
      '/api/sim/calls',
      {
        preHandler: staff,
        schema: {
          tags: ['simulator'],
          body: SimStartBody,
          response: { 200: SimTurnResult, 404: ErrorBody, 409: ErrorBody },
        },
      },
      async (req, reply) => {
        try {
          return await withScope('app', req.auth!.scope, (db) =>
            beginCall(db, { patientId: req.body.patientId, llm, channel: 'simulator' }),
          );
        } catch (e) {
          const f = fail(e);
          return reply.code(f.status as 404).send(f.body);
        }
      },
    );

    app.post(
      '/api/sim/calls/:id/turn',
      {
        preHandler: staff,
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['simulator'],
          params: z.object({ id: z.uuid() }),
          body: SimTurnBody,
          response: { 200: SimTurnResult, 404: ErrorBody, 409: ErrorBody },
        },
      },
      async (req, reply) => {
        try {
          const r = await callTurn(
            (fn) => withScope('app', req.auth!.scope, fn),
            req.params.id,
            req.body.text,
            llm,
            'simulator',
          );
          // "Yes, help me with that" on the call proposes the warning's skill (rule 2.2: closed table).
          for (const w of r.helpWanted) {
            const proposed = await withScope('worker', systemScope('agent'), (db) =>
              proposeForWarning(db, w, 'call'),
            );
            for (const p of proposed.filter((x) => x.created && x.state === 'approved'))
              await deps.queue?.add('action.run', { actionId: p.id });
          }
          return r;
        } catch (e) {
          const f = fail(e);
          return reply.code(f.status as 404).send(f.body);
        }
      },
    );
  };
