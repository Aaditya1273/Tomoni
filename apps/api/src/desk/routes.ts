/**
 * Doctor desk: a patient's timeline and care plans, the APCM billing list with its evidence
 * export, and the practice report (BUILD_PROMPT §5.6). Staff only; everything is scoped to the
 * caller's practices by RLS and by explicit filters, and every read of PHI is audited.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ApcmList, CarePlanItem, DeskPatient, ErrorBody, Month, PracticeReport } from '@tomoni/contracts';
import {
  APCM_RATE_CENTS,
  buildApcmMonth,
  draftCarePlan,
  latestPlans,
  monthBounds,
  signCarePlan,
} from '@tomoni/care';
import type { RequestScope } from '@tomoni/core';
import { audit, schema, withScope } from '@tomoni/db';
import { requireAuth } from '../auth/session';

const STAFF = requireAuth({ roles: ['physician', 'nurse', 'front_desk'] });
const PHYSICIAN = requireAuth({ roles: ['physician'] });
const Id = z.object({ id: z.uuid() });
const MonthQ = z.object({ month: Month });
const ORDER = { ready: 0, billed: 1, draft: 2, excluded: 3 } as const;

const planItem = (p: typeof schema.carePlan.$inferSelect) => ({
  id: p.id,
  version: p.version,
  status: p.status,
  body: p.body,
  draftedBy: p.draftedBy === 'agent' ? 'agent' : 'staff',
  signedAt: p.signedAt?.toISOString() ?? null,
});

export const deskRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/api/desk/patients/:id',
    {
      preHandler: STAFF,
      schema: { tags: ['desk'], params: Id, response: { 200: DeskPatient, 404: ErrorBody } },
    },
    async (req, reply) => {
      const s = req.auth!.scope;
      const out = await withScope('app', s, async (db) => {
        const [p] = await db
          .select()
          .from(schema.patient)
          .where(
            and(
              eq(schema.patient.id, req.params.id),
              sql`practice_id = ANY(${sql.param(s.staffPracticeIds)}::uuid[])`,
            ),
          );
        if (!p) return null;
        const { rows: timeline } = await db.execute<z.infer<typeof DeskPatient>['timeline'][number]>(sql`
          SELECT * FROM (
            SELECT coalesce(started_at, created_at)::text AS at, 'call' AS kind,
                   'Call: ' || coalesce(outcome, step) AS title, NULL AS detail, id::text AS ref
              FROM care.call WHERE patient_id = ${p.id}
            UNION ALL
            SELECT fill_date::text, 'fill', 'Filled ' || coalesce(m.display_name, f.ndc),
                   f.days_supply || ' days', f.id::text
              FROM care.fill f LEFT JOIN care.medication m ON m.id = f.medication_id
             WHERE f.patient_id = ${p.id} AND f.fill_date > now() - interval '120 days'
            UNION ALL
            SELECT created_at::text, 'warning', 'Warning: ' || replace(type, '_', ' '),
                   coalesce(evidence->>'drug', evidence->>'plan') || ' · ' || status, id::text
              FROM care.warning WHERE patient_id = ${p.id}
            UNION ALL
            SELECT updated_at::text, 'action', 'Tomoni: ' || skill, state, id::text
              FROM care.action WHERE patient_id = ${p.id}
            UNION ALL
            SELECT created_at::text, 'flag', 'Nurse flag: ' || replace(class, '_', ' '), status, id::text
              FROM care.nurse_flag WHERE patient_id = ${p.id}
            UNION ALL
            SELECT coalesce(signed_at, created_at)::text, 'care_plan', 'Care plan v' || version, status, id::text
              FROM care.care_plan WHERE patient_id = ${p.id}
          ) t ORDER BY at DESC LIMIT 200`);
        const [consent] = await db
          .select({ id: schema.careConsent.id })
          .from(schema.careConsent)
          .where(and(eq(schema.careConsent.patientId, p.id), sql`withdrawn_at IS NULL`));
        await audit(db, {
          action: 'read',
          entityType: 'patient',
          entityId: p.id,
          patientId: p.id,
          purpose: 'treatment',
        });
        return {
          id: p.id,
          name: p.name,
          locale: p.locale,
          birthYear: p.birthYear,
          apcmEnrolled: !!consent,
          carePlans: (await latestPlans(db, p.id)).map(planItem),
          // "Tomoni: draftRenewalForDoctor" → "Tomoni: draft renewal for doctor"
          timeline: timeline.map((e) =>
            e.kind === 'action'
              ? {
                  ...e,
                  title: e.title
                    .replace(/([a-z])([A-Z])/g, '$1 $2')
                    .replace(/: (.)/, (m) => m.toLowerCase())
                    .replace(/ [A-Z]/g, (m) => m.toLowerCase()),
                }
              : e,
          ),
        };
      });
      return (
        out ?? reply.code(404).send({ error: 'not_found', message: 'No such patient in your practice.' })
      );
    },
  );

  app.post(
    '/api/desk/patients/:id/care-plan/draft',
    {
      preHandler: STAFF,
      schema: { tags: ['desk'], params: Id, response: { 200: CarePlanItem, 404: ErrorBody } },
    },
    async (req, reply) => {
      const plan = await withScope('app', req.auth!.scope, async (db) => {
        const [p] = await db
          .select({ id: schema.patient.id })
          .from(schema.patient)
          .where(eq(schema.patient.id, req.params.id));
        return p ? draftCarePlan(db, p.id, 'agent') : null;
      });
      return plan
        ? planItem(plan)
        : reply.code(404).send({ error: 'not_found', message: 'No such patient.' });
    },
  );

  app.post(
    '/api/desk/care-plans/:id/sign',
    {
      preHandler: PHYSICIAN,
      schema: { tags: ['desk'], params: Id, response: { 200: CarePlanItem, 403: ErrorBody, 404: ErrorBody } },
    },
    async (req, reply) => {
      try {
        const signed = await withScope('app', req.auth!.scope, (db) =>
          signCarePlan(db, req.params.id, req.auth!.userId),
        );
        return signed
          ? planItem(signed)
          : reply.code(404).send({ error: 'not_found', message: 'No draft with that id.' });
      } catch {
        return reply
          .code(403)
          .send({ error: 'forbidden', message: 'Only a physician of this practice can sign.' });
      }
    },
  );

  const listMonth = (s: RequestScope, month: string) =>
    withScope('app', s, async (db) => {
      const rows = await db
        .select({ r: schema.apcmMonthRecord, name: schema.patient.name })
        .from(schema.apcmMonthRecord)
        .innerJoin(schema.patient, eq(schema.patient.id, schema.apcmMonthRecord.patientId))
        .where(
          and(
            eq(schema.apcmMonthRecord.month, monthBounds(month).start),
            sql`${schema.apcmMonthRecord.practiceId} = ANY(${sql.param(s.staffPracticeIds)}::uuid[])`,
          ),
        );
      await audit(db, {
        action: 'read',
        entityType: 'apcm_month',
        purpose: 'payment',
        details: { month, n: rows.length },
      });
      return (
        rows
          .map(({ r, name }) => ({
            id: r.id,
            patientId: r.patientId,
            patientName: name,
            month: r.month,
            hcpcs: r.hcpcs,
            chronicConditions: r.chronicConditions,
            status: r.status,
            exclusionReason: r.exclusionReason,
            services: r.services.length,
            rateCents: r.hcpcs && r.status !== 'excluded' ? APCM_RATE_CENTS[r.hcpcs] : null,
            serviceList: r.services,
            consentId: r.consentId,
            carePlanId: r.carePlanId,
          }))
          // What needs the biller first: ready, then billed, then the rest with their reasons.
          .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.patientName.localeCompare(b.patientName))
      );
    });

  app.get(
    '/api/desk/apcm',
    { preHandler: STAFF, schema: { tags: ['desk'], querystring: MonthQ, response: { 200: ApcmList } } },
    async (req) => listMonth(req.auth!.scope, req.query.month),
  );

  app.post(
    '/api/desk/apcm/build',
    {
      preHandler: STAFF,
      schema: {
        tags: ['desk'],
        body: z.strictObject({ month: Month }),
        response: { 200: z.object({ patients: z.number(), ready: z.number() }) },
      },
    },
    async (req) => {
      const s = req.auth!.scope;
      const r = await withScope('app', s, (db) => buildApcmMonth(db, s.staffPracticeIds, req.body.month));
      return { patients: r.patients, ready: r.ready };
    },
  );

  app.post(
    '/api/desk/apcm/:id/billed',
    {
      preHandler: requireAuth({ roles: ['physician', 'front_desk'] }),
      schema: { tags: ['desk'], params: Id, response: { 204: z.null(), 404: ErrorBody } },
    },
    async (req, reply) => {
      const ok = await withScope('app', req.auth!.scope, async (db) => {
        const [r] = await db
          .update(schema.apcmMonthRecord)
          .set({ status: 'billed', billedAt: new Date(), billedBy: req.auth!.userId })
          .where(
            and(eq(schema.apcmMonthRecord.id, req.params.id), eq(schema.apcmMonthRecord.status, 'ready')),
          )
          .returning({ patientId: schema.apcmMonthRecord.patientId });
        if (r)
          await audit(db, {
            action: 'update',
            entityType: 'apcm_month',
            entityId: req.params.id,
            patientId: r.patientId,
            purpose: 'payment',
            details: { status: 'billed' },
          });
        return !!r;
      });
      return ok
        ? reply.code(204).send(null)
        : reply.code(404).send({ error: 'not_found', message: 'No ready record with that id.' });
    },
  );

  /** The evidence export a biller or auditor reads: one row per ready or billed patient-month. */
  app.get(
    '/api/desk/apcm/export',
    {
      preHandler: requireAuth({ roles: ['physician', 'front_desk'] }),
      schema: { tags: ['desk'], querystring: MonthQ },
    },
    async (req, reply) => {
      const s = req.auth!.scope;
      const rows = (await listMonth(s, req.query.month)).filter(
        (r) => r.status === 'ready' || r.status === 'billed',
      );
      await withScope('app', s, (db) =>
        audit(db, {
          action: 'export',
          entityType: 'apcm_month',
          purpose: 'payment',
          details: { month: req.query.month, rows: rows.length },
        }),
      );
      // A leading =, +, - or @ would run as a formula in a spreadsheet: prefix it (CSV injection).
      const cell = (v: unknown) => {
        const t = String(v ?? '').replace(/^([=+\-@])/, "'$1");
        return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
      };
      const header = [
        'patient',
        'month',
        'hcpcs',
        'chronic_conditions',
        'consent_id',
        'care_plan_id',
        'services',
        'status',
      ];
      const lines = rows.map((r) =>
        [
          r.patientName,
          r.month,
          r.hcpcs,
          r.chronicConditions.join('; '),
          r.consentId,
          r.carePlanId,
          r.serviceList.map((x) => `${x.kind}@${x.at.slice(0, 10)}#${x.ref}`).join('; '),
          r.status,
        ]
          .map(cell)
          .join(','),
      );
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="apcm-${req.query.month}.csv"`)
        .send([header.join(','), ...lines].join('\n') + '\n');
    },
  );

  app.get(
    '/api/desk/report',
    { preHandler: STAFF, schema: { tags: ['desk'], querystring: MonthQ, response: { 200: PracticeReport } } },
    async (req) => {
      const s = req.auth!.scope;
      const { start, next } = monthBounds(req.query.month);
      return withScope('app', s, async (db) => {
        const ids = sql.param(s.staffPracticeIds);
        const { rows } = await db.execute<Record<string, number>>(sql`
          WITH pts AS (SELECT id FROM care.patient WHERE practice_id = ANY(${ids}::uuid[]))
          SELECT
            (SELECT count(*) FROM care.care_consent WHERE program = 'apcm' AND patient_id IN (SELECT id FROM pts)
               AND given_at < ${next}::date AND (withdrawn_at IS NULL OR withdrawn_at >= ${start}::date))::int AS enrolled,
            (SELECT count(*) FROM care.call WHERE patient_id IN (SELECT id FROM pts) AND outcome IN ('completed','escalated')
               AND started_at >= ${start}::date AND started_at < ${next}::date)::int AS calls,
            (SELECT count(*) FROM care.nurse_flag WHERE patient_id IN (SELECT id FROM pts)
               AND created_at >= ${start}::date AND created_at < ${next}::date)::int AS flags_raised,
            (SELECT count(*) FROM care.nurse_flag WHERE patient_id IN (SELECT id FROM pts)
               AND acknowledged_at >= ${start}::date AND acknowledged_at < ${next}::date)::int AS flags_handled,
            (SELECT count(*) FROM care.action WHERE patient_id IN (SELECT id FROM pts) AND state = 'succeeded'
               AND updated_at >= ${start}::date AND updated_at < ${next}::date)::int AS tasks,
            -- A problem caught early: the warning closed before the day it would have hit.
            (SELECT count(*) FROM care.warning WHERE patient_id IN (SELECT id FROM pts) AND status = 'resolved'
               AND resolved_at >= ${start}::date AND resolved_at < ${next}::date
               AND resolved_at::date < problem_date)::int AS caught`);
        const r = rows[0]!;
        const recs = await listMonth(s, req.query.month);
        const count = (st: string) => recs.filter((x) => x.status === st).length;
        return {
          month: start,
          enrolled: r.enrolled ?? 0,
          ready: count('ready'),
          billed: count('billed'),
          excluded: count('excluded'),
          apcmRevenueCents: recs.reduce(
            (a, x) => a + (x.status === 'ready' || x.status === 'billed' ? (x.rateCents ?? 0) : 0),
            0,
          ),
          callsCompleted: r.calls ?? 0,
          flagsRaised: r.flags_raised ?? 0,
          flagsHandled: r.flags_handled ?? 0,
          tasksDoneByTomoni: r.tasks ?? 0,
          problemsCaughtEarly: r.caught ?? 0,
        };
      });
    },
  );
};
