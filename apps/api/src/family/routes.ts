/**
 * Family: what Tomoni did (activity log), call streaks, the week in numbers, and invites for
 * siblings and the doctor (BUILD_PROMPT §5.5). Activity carries plain facts only: no call
 * transcripts, no flag excerpts, no adapter text.
 */
import { createHash } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AcceptInviteBody, Activity, ErrorBody, InviteBody, InviteResult } from '@tomoni/contracts';
import { systemScope } from '@tomoni/core';
import { audit, schema, withScope } from '@tomoni/db';
import { today } from '@tomoni/medicines';
import { newToken, requireAuth } from '../auth/session';
import { hashPassword } from '../auth/password';
import { callStreak } from './streaks';

const FAMILY = requireAuth({ roles: ['family_member', 'patient', 'representative'] });
/** Assumption for the time counter: each task Tomoni finished saves a family member ~15 minutes of phone calls. */
const MINUTES_PER_TASK = 15;
const sha = (t: string) => createHash('sha256').update(t).digest();

export const familyExtraRoutes =
  (deps: { publicOrigin: string }): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/api/family/activity',
      { preHandler: FAMILY, schema: { tags: ['family'], response: { 200: Activity } } },
      async (req) => {
        const s = req.auth!.scope;
        return withScope('app', s, async (db) => {
          const people = await db
            .select({
              id: schema.patient.id,
              name: schema.patient.name,
              preferred: schema.patient.preferredName,
              tz: schema.patient.tz,
            })
            .from(schema.patient)
            .where(
              or(
                s.householdIds.length ? inArray(schema.patient.householdId, s.householdIds) : sql`false`,
                s.patientIds.length ? inArray(schema.patient.id, s.patientIds) : sql`false`,
              ),
            );
          if (!people.length)
            return {
              events: [],
              streaks: [],
              week: { calls: 0, problemsCaught: 0, tasksDone: 0, minutesSaved: 0 },
            };
          const ids = sql.param(people.map((p) => p.id));
          const { rows } = await db.execute<{
            at: string;
            patient_id: string;
            kind: 'call' | 'action' | 'warning' | 'flag';
            what: string;
            a: string | null;
            b: string | null;
          }>(sql`
          SELECT * FROM (
            SELECT coalesce(started_at, created_at)::text AS at, patient_id, 'call' AS kind, 'call.' || outcome AS what, NULL AS a, NULL AS b
              FROM care.call WHERE patient_id = ANY(${ids}::uuid[]) AND outcome IS NOT NULL
            UNION ALL
            SELECT a.updated_at::text, a.patient_id, 'action', 'action.' || a.state, a.skill, w.evidence->>'drug'
              FROM care.action a LEFT JOIN care.warning w ON w.id = a.warning_id
             WHERE a.patient_id = ANY(${ids}::uuid[]) AND a.state IN ('succeeded','awaiting_approval','handoff','rejected')
            UNION ALL
            SELECT created_at::text, patient_id, 'warning', 'warning.created', type, evidence->>'drug'
              FROM care.warning WHERE patient_id = ANY(${ids}::uuid[]) AND type <> 'gene_drug_mismatch'
            UNION ALL
            SELECT created_at::text, patient_id, 'flag', 'flag.' || class, NULL, NULL
              FROM care.nurse_flag WHERE patient_id = ANY(${ids}::uuid[])
          ) t WHERE at::timestamptz > now() - interval '30 days' ORDER BY at DESC LIMIT 100`);
          const nameOf = new Map(people.map((p) => [p.id, p.preferred ?? p.name]));
          const { rows: calls } = await db.execute<{ patient_id: string; day: string }>(sql`
          SELECT DISTINCT c.patient_id, (c.started_at AT TIME ZONE p.tz)::date::text AS day
            FROM care.call c JOIN care.patient p ON p.id = c.patient_id
           WHERE c.patient_id = ANY(${ids}::uuid[]) AND c.outcome IN ('completed','escalated')
             AND c.started_at > now() - interval '400 days'`);
          const { rows: wk } = await db.execute<{ calls: number; caught: number; tasks: number }>(sql`
          SELECT (SELECT count(*) FROM care.call WHERE patient_id = ANY(${ids}::uuid[]) AND outcome IN ('completed','escalated')
                    AND started_at > now() - interval '7 days')::int AS calls,
                 (SELECT count(*) FROM care.warning WHERE patient_id = ANY(${ids}::uuid[]) AND status = 'resolved'
                    AND resolved_at > now() - interval '7 days' AND resolved_at::date < problem_date)::int AS caught,
                 (SELECT count(*) FROM care.action WHERE patient_id = ANY(${ids}::uuid[]) AND state = 'succeeded'
                    AND updated_at > now() - interval '7 days')::int AS tasks`);
          for (const p of people)
            await audit(db, {
              action: 'read',
              entityType: 'family_activity',
              patientId: p.id,
              purpose: 'treatment',
            });
          const w = wk[0]!;
          return {
            events: rows.map((r) => ({
              at: new Date(r.at).toISOString(),
              patientId: r.patient_id,
              patientName: nameOf.get(r.patient_id) ?? '',
              kind: r.kind,
              what: r.what,
              facts: {
                skill: r.kind === 'action' ? r.a : null,
                type: r.kind === 'warning' ? r.a : null,
                drug: r.b,
              },
            })),
            streaks: people.map((p) => {
              const st = callStreak(
                new Set(calls.filter((c) => c.patient_id === p.id).map((c) => c.day)),
                today(),
              );
              return {
                patientId: p.id,
                patientName: p.preferred ?? p.name,
                callStreak: st.days,
                shieldUsed: st.shieldUsed,
              };
            }),
            week: {
              calls: w.calls,
              problemsCaught: w.caught,
              tasksDone: w.tasks,
              minutesSaved: w.tasks * MINUTES_PER_TASK,
            },
          };
        });
      },
    );

    app.post(
      '/api/family/invites',
      {
        preHandler: requireAuth({ roles: ['family_member'] }),
        config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
        schema: { tags: ['family'], body: InviteBody, response: { 200: InviteResult } },
      },
      async (req) => {
        const a = req.auth!;
        const householdId = a.scope.householdIds[0]!;
        // Sibling invites are a link the family shares itself (WhatsApp, text); doctor invites go to ops.
        const token = req.body.kind === 'sibling' ? newToken() : null;
        const row = await withScope('app', a.scope, async (db) => {
          const [r] = await db
            .insert(schema.invite)
            .values({
              householdId,
              kind: req.body.kind,
              target: req.body.email.toLowerCase(),
              tokenHash: token ? sha(token) : null,
              createdBy: a.userId,
              expiresAt: new Date(Date.now() + 7 * 86_400_000),
            })
            .returning({ id: schema.invite.id });
          await audit(db, {
            action: 'create',
            entityType: 'invite',
            entityId: r!.id,
            purpose: 'operations',
            details: { kind: req.body.kind },
          });
          return r!;
        });
        return { id: row.id, acceptUrl: token ? `${deps.publicOrigin}/invite/${token}` : null };
      },
    );

    app.post(
      '/api/invites/accept',
      {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        schema: {
          tags: ['family'],
          body: AcceptInviteBody,
          response: { 204: z.null(), 400: ErrorBody, 409: ErrorBody },
        },
      },
      async (req, reply) => {
        const pw = await hashPassword(req.body.password);
        // No session yet: the single-use token is the authority, checked and spent in one transaction.
        const result = await withScope('worker', systemScope('invite.accept'), async (db) => {
          const [inv] = await db
            .select()
            .from(schema.invite)
            .where(eq(schema.invite.tokenHash, sha(req.body.token)))
            .for('update');
          if (!inv || inv.status !== 'pending' || inv.expiresAt < new Date() || inv.kind !== 'sibling')
            return 'invalid' as const;
          const [exists] = await db
            .select({ id: schema.userAccount.id })
            .from(schema.userAccount)
            .where(eq(schema.userAccount.email, inv.target));
          if (exists) return 'exists' as const;
          const [u] = await db
            .insert(schema.userAccount)
            .values({ email: inv.target, displayName: req.body.displayName, passwordHash: pw })
            .returning({ id: schema.userAccount.id });
          await db.insert(schema.roleGrant).values({
            userId: u!.id,
            role: 'family_member',
            householdId: inv.householdId,
            grantedBy: inv.createdBy,
          });
          await db.insert(schema.familyMember).values({
            householdId: inv.householdId,
            userId: u!.id,
            displayName: req.body.displayName,
            relationship: 'sibling',
          });
          await db
            .update(schema.invite)
            .set({ status: 'accepted', acceptedBy: u!.id })
            .where(eq(schema.invite.id, inv.id));
          await audit(db, {
            action: 'consent_change',
            entityType: 'invite',
            entityId: inv.id,
            purpose: 'operations',
            details: { accepted: true },
          });
          return 'ok' as const;
        });
        if (result === 'invalid')
          return reply
            .code(400)
            .send({ error: 'invalid_invite', message: 'This invite link is not valid any more.' });
        if (result === 'exists')
          return reply
            .code(409)
            .send({ error: 'exists', message: 'That e-mail already has a Tomoni account. Sign in instead.' });
        return reply.code(204).send(null);
      },
    );
  };
