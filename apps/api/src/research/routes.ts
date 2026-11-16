/**
 * Research (Phase 5): the registry consent families give and withdraw, the doctor's trial
 * introductions, and the research coordinator's funnel. Care and research stay separate records
 * (rule 2.5); the database refuses research data without active consent.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Queue } from 'bullmq';
import { eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ErrorBody,
  MatchStage,
  ResearchConsentBody,
  ResearchMatches,
  ResearchOverview,
  TrialIntros,
} from '@tomoni/contracts';
import { systemScope } from '@tomoni/core';
import { audit, schema, withScope } from '@tomoni/db';
import { BILLABLE, canAdvance, type Stage } from '@tomoni/trials';
import { requireAuth } from '../auth/session';

const FAMILY = requireAuth({ roles: ['family_member', 'patient', 'representative'] });
const research = systemScope('research');

export const researchRoutes =
  (deps: { queue: Queue }): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/api/research',
      { preHandler: FAMILY, schema: { tags: ['research'], response: { 200: ResearchOverview } } },
      async (req) => {
        const a = req.auth!;
        const s = a.scope;
        return withScope('app', s, async (db) => {
          const { rows: protos } = await db.execute<{
            id: string;
            title: string;
            code: string;
            version: number;
            irb_name: string;
            irb_approval_ref: string | null;
            expires_at: string | null;
            plain_summary: Record<string, string>;
          }>(sql`SELECT id, title, code, version, irb_name, irb_approval_ref, expires_at::text, plain_summary
                 FROM research.protocol WHERE status = 'approved' AND expires_at >= current_date
                ORDER BY approved_at DESC LIMIT 1`);
          const p = protos[0];
          const people = await db
            .select({
              id: schema.patient.id,
              name: schema.patient.name,
              preferred: schema.patient.preferredName,
              locale: schema.patient.locale,
            })
            .from(schema.patient)
            .where(
              or(
                s.householdIds.length ? inArray(schema.patient.householdId, s.householdIds) : sql`false`,
                s.patientIds.length ? inArray(schema.patient.id, s.patientIds) : sql`false`,
              ),
            );
          const out = [];
          for (const person of people) {
            const { rows: reps } = await db.execute<{ id: string }>(sql`
            SELECT r.id FROM care.representative r JOIN care.family_member fm ON fm.id = r.family_member_id
             WHERE r.patient_id = ${person.id} AND fm.user_id = ${a.userId} AND r.verified_by IS NOT NULL
               AND r.valid_from <= current_date AND (r.valid_to IS NULL OR r.valid_to >= current_date) LIMIT 1`);
            const { rows: consents } = await db.execute<{
              id: string;
              scope_speech_task: boolean;
              scope_trial_matching: boolean;
              scope_pgx_research: boolean;
              recording_permission: boolean;
              given_at: string;
              given_by_kind: string;
            }>(sql`SELECT id, scope_speech_task, scope_trial_matching, scope_pgx_research, recording_permission,
                        given_at::text, given_by_kind FROM research.research_consent
                  WHERE patient_id = ${person.id} AND withdrawn_at IS NULL ${p ? sql`AND protocol_id = ${p.id}` : sql``}`);
            const c = consents[0];
            out.push({
              patientId: person.id,
              name: person.preferred ?? person.name,
              canConsentAs: s.patientIds.includes(person.id)
                ? ('patient' as const)
                : reps[0]
                  ? ('representative' as const)
                  : null,
              representativeId: reps[0]?.id ?? null,
              consent: c
                ? {
                    id: c.id,
                    scopes: {
                      speechTask: c.scope_speech_task,
                      trialMatching: c.scope_trial_matching,
                      pgxResearch: c.scope_pgx_research,
                    },
                    recordingPermission: c.recording_permission,
                    givenAt: new Date(c.given_at).toISOString(),
                    givenBy: c.given_by_kind,
                  }
                : null,
            });
          }
          const locale = people[0]?.locale ?? 'en';
          return {
            protocol: p
              ? {
                  id: p.id,
                  title: p.title,
                  code: p.code,
                  version: p.version,
                  irbName: p.irb_name,
                  irbApprovalRef: p.irb_approval_ref,
                  expiresAt: p.expires_at,
                  summary: p.plain_summary[locale] ?? p.plain_summary.en ?? '',
                }
              : null,
            people: out,
          };
        });
      },
    );

    app.post(
      '/api/research/consents',
      {
        preHandler: FAMILY,
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        schema: {
          tags: ['research'],
          body: ResearchConsentBody,
          response: { 200: z.object({ id: z.uuid() }), 400: ErrorBody, 403: ErrorBody },
        },
      },
      async (req, reply) => {
        const a = req.auth!;
        const b = req.body;
        if (!b.scopes.speechTask && !b.scopes.trialMatching && !b.scopes.pgxResearch)
          return reply
            .code(400)
            .send({ error: 'no_scope', message: 'Choose at least one way your data may be used.' });
        try {
          const id = await withScope('app', a.scope, async (db) => {
            const self = a.scope.patientIds.includes(b.patientId);
            const { rows: reps } = await db.execute<{ id: string }>(sql`
              SELECT r.id FROM care.representative r JOIN care.family_member fm ON fm.id = r.family_member_id
               WHERE r.patient_id = ${b.patientId} AND fm.user_id = ${a.userId} AND r.verified_by IS NOT NULL
                 AND r.valid_from <= current_date AND (r.valid_to IS NULL OR r.valid_to >= current_date) LIMIT 1`);
            const rep = self ? null : reps[0]?.id;
            const [p] = await db
              .select({ locale: schema.patient.locale })
              .from(schema.patient)
              .where(eq(schema.patient.id, b.patientId));
            const { rows } = await db.execute<{ id: string }>(sql`
              INSERT INTO research.research_consent (patient_id, protocol_id, given_by_kind, given_by_id, hipaa_authorization_ref,
                recording_permission, scope_speech_task, scope_trial_matching, scope_pgx_research, method, locale, recorded_by)
              VALUES (${b.patientId}, ${b.protocolId}, ${self ? 'patient' : 'representative'}, ${rep ?? null},
                      ${'HIPAA-AUTH-' + b.protocolId.slice(0, 8)}, ${b.recordingPermission}, ${b.scopes.speechTask},
                      ${b.scopes.trialMatching}, ${b.scopes.pgxResearch}, 'e_sign', ${p?.locale ?? 'en'}, ${a.userId})
              RETURNING id`);
            await audit(db, {
              action: 'consent_change',
              entityType: 'research_consent',
              entityId: rows[0]!.id,
              patientId: b.patientId,
              purpose: 'research',
              details: {
                given: true,
                ...b.scopes,
                recording: b.recordingPermission,
                signedAs: self ? 'patient' : 'representative',
              },
            });
            return rows[0]!.id;
          });
          await withScope('worker', research, (db) =>
            db.execute(
              sql`INSERT INTO research.research_id (patient_id) VALUES (${b.patientId}) ON CONFLICT DO NOTHING`,
            ),
          );
          if (b.scopes.trialMatching) await deps.queue.add('trials.match', {});
          return { id };
        } catch {
          return reply.code(403).send({
            error: 'forbidden',
            message: 'Only the patient or their legal representative can give this consent.',
          });
        }
      },
    );

    app.post(
      '/api/research/consents/:id/withdraw',
      {
        preHandler: requireAuth(),
        schema: {
          tags: ['research'],
          params: z.object({ id: z.uuid() }),
          response: { 204: z.null(), 404: ErrorBody },
        },
      },
      async (req, reply) => {
        const ok = await withScope('app', req.auth!.scope, async (db) => {
          const { rows } = await db.execute<{ patient_id: string }>(sql`
            UPDATE research.research_consent SET withdrawn_at = now(), withdrawal_recorded_by = ${req.auth!.userId}
             WHERE id = ${req.params.id} AND withdrawn_at IS NULL RETURNING patient_id`);
          if (rows[0])
            await audit(db, {
              action: 'consent_change',
              entityType: 'research_consent',
              entityId: req.params.id,
              patientId: rows[0].patient_id,
              purpose: 'research',
              details: { withdrawn: true },
            });
          return !!rows[0];
        });
        return ok
          ? reply.code(204).send(null)
          : reply.code(404).send({ error: 'not_found', message: 'No active consent with that id.' });
      },
    );

    // ── The doctor introduces the trial (PRODUCT "Engine 1", step 3) ─────────
    app.get(
      '/api/desk/trial-intros',
      {
        preHandler: requireAuth({ roles: ['physician', 'nurse'] }),
        schema: { tags: ['desk'], response: { 200: TrialIntros } },
      },
      async (req) => {
        const s = req.auth!.scope;
        const rows = await withScope(
          'worker',
          research,
          async (db) =>
            (
              await db.execute<{
                match_id: string;
                patient_id: string;
                title: string;
                area: string;
                status: string;
              }>(sql`
              SELECT m.id AS match_id, r.patient_id, t.title, t.therapeutic_area AS area, m.status
                FROM research.trial_match m JOIN research.research_id r ON r.research_pid = m.research_pid
                JOIN research.trial t ON t.id = m.trial_id JOIN care.patient p ON p.id = r.patient_id
               WHERE p.practice_id = ANY(${sql.param(s.staffPracticeIds)}::uuid[]) AND m.status IN ('matched','prescreened')
                 AND t.status = 'recruiting' ORDER BY m.matched_at LIMIT 100`)
            ).rows,
        );
        if (!rows.length) return [];
        return withScope('app', s, async (db) => {
          const people = await db
            .select({ id: schema.patient.id, name: schema.patient.name })
            .from(schema.patient)
            .where(inArray(schema.patient.id, [...new Set(rows.map((r) => r.patient_id))]));
          const nameOf = new Map(people.map((p) => [p.id, p.name]));
          return rows
            .filter((r) => nameOf.has(r.patient_id))
            .map((r) => ({
              matchId: r.match_id,
              patientId: r.patient_id,
              patientName: nameOf.get(r.patient_id)!,
              trialTitle: r.title,
              therapeuticArea: r.area,
              status: r.status,
            }));
        });
      },
    );

    const advance = async (
      matchId: string,
      to: Stage,
      guard: (patientPracticeId: string) => boolean,
      actorPurpose: 'treatment' | 'research',
      by: string, // who moved it: the worker role writes the row, the person is recorded here
    ) =>
      withScope('worker', research, async (db) => {
        const { rows } = await db.execute<{
          status: Stage;
          patient_id: string;
          practice_id: string;
          sponsor_id: string;
          trial_id: string;
        }>(sql`
          SELECT m.status, r.patient_id, p.practice_id, t.sponsor_id, t.id AS trial_id
            FROM research.trial_match m JOIN research.research_id r ON r.research_pid = m.research_pid
            JOIN care.patient p ON p.id = r.patient_id JOIN research.trial t ON t.id = m.trial_id
           WHERE m.id = ${matchId} FOR UPDATE OF m`);
        const m = rows[0];
        if (!m || !guard(m.practice_id)) return 'not_found' as const;
        if (!canAdvance(m.status, to)) return 'bad_step' as const;
        await db.execute(sql`UPDATE research.trial_match SET status = ${to} WHERE id = ${matchId}`);
        const unit = BILLABLE[to];
        if (unit)
          await db.execute(sql`INSERT INTO research.service_event (sponsor_id, trial_id, trial_match_id, unit)
                               VALUES (${m.sponsor_id}, ${m.trial_id}, ${matchId}, ${unit})`);
        await audit(db, {
          action: 'update',
          entityType: 'trial_match',
          entityId: matchId,
          patientId: m.patient_id,
          purpose: actorPurpose,
          details: { status: to, by },
        });
        return 'ok' as const;
      });

    app.post(
      '/api/desk/trial-intros/:id',
      {
        preHandler: requireAuth({ roles: ['physician'] }),
        schema: {
          tags: ['desk'],
          params: z.object({ id: z.uuid() }),
          body: z.strictObject({ outcome: z.enum(['introduced', 'declined']) }),
          response: { 204: z.null(), 404: ErrorBody, 409: ErrorBody },
        },
      },
      async (req, reply) => {
        const s = req.auth!.scope;
        const r = await advance(
          req.params.id,
          req.body.outcome,
          (pp) => s.staffPracticeIds.includes(pp),
          'treatment',
          req.auth!.userId,
        );
        if (r === 'not_found')
          return reply
            .code(404)
            .send({ error: 'not_found', message: 'No such introduction for your patients.' });
        if (r === 'bad_step')
          return reply.code(409).send({ error: 'bad_step', message: 'That step is not next.' });
        return reply.code(204).send(null);
      },
    );

    // ── The research coordinator moves the funnel. Names come only for people in a match, read
    // under the worker role (the coordinator has no care scope), and every read is audited. ──
    app.get(
      '/api/research/matches',
      {
        preHandler: requireAuth({ roles: ['research_coordinator'] }),
        schema: { tags: ['research'], response: { 200: ResearchMatches } },
      },
      async (req) => {
        const rows = await withScope(
          'worker',
          research,
          async (db) =>
            (
              await db.execute<{
                match_id: string;
                patient_id: string;
                title: string;
                status: string;
                updated_at: string;
              }>(sql`
            SELECT m.id AS match_id, r.patient_id, t.title, m.status, m.updated_at::text
              FROM research.trial_match m JOIN research.research_id r ON r.research_pid = m.research_pid
              JOIN research.trial t ON t.id = m.trial_id ORDER BY m.updated_at DESC LIMIT 200`)
            ).rows,
        );
        const people = rows.length
          ? await withScope('worker', research, (db) =>
              db
                .select({ id: schema.patient.id, name: schema.patient.name })
                .from(schema.patient)
                .where(
                  inArray(
                    schema.patient.id,
                    rows.map((r) => r.patient_id),
                  ),
                ),
            )
          : [];
        const nameOf = new Map(people.map((p) => [p.id, p.name]));
        return withScope('app', req.auth!.scope, async (db) => {
          await audit(db, {
            action: 'read',
            entityType: 'trial_match',
            purpose: 'research',
            details: { n: rows.length },
          });
          return rows.map((r) => ({
            matchId: r.match_id,
            patientName: nameOf.get(r.patient_id) ?? '',
            trialTitle: r.title,
            status: r.status,
            updatedAt: new Date(r.updated_at).toISOString(),
          }));
        });
      },
    );

    app.post(
      '/api/research/matches/:id/stage',
      {
        preHandler: requireAuth({ roles: ['research_coordinator'] }),
        schema: {
          tags: ['research'],
          params: z.object({ id: z.uuid() }),
          body: z.strictObject({ stage: MatchStage }),
          response: { 204: z.null(), 404: ErrorBody, 409: ErrorBody },
        },
      },
      async (req, reply) => {
        const r = await advance(req.params.id, req.body.stage, () => true, 'research', req.auth!.userId);
        if (r === 'not_found') return reply.code(404).send({ error: 'not_found', message: 'No such match.' });
        if (r === 'bad_step')
          return reply.code(409).send({ error: 'bad_step', message: 'That step is not next.' });
        return reply.code(204).send(null);
      },
    );
  };
