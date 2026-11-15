/**
 * Family surface: the morning card (every medicine, every warning, its source), the evidence
 * behind a warning, and connecting Medicare through Blue Button. Every read is audited.
 */
import { createHash } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { scopeFromGrants, type RequestScope, type RoleGrant } from '@tomoni/core';
import {
  BlueButtonConnect,
  ErrorBody,
  FamilyCard,
  WarningEvidence,
  WarningFacts,
  type AccessStatus,
  type WarningItem,
} from '@tomoni/contracts';
import { audit, pool, schema, withScope, type Db } from '@tomoni/db';
import { blueButtonFromEnv, mockBeneficiaryId, pkce, today, worst, type BlueButton } from '@tomoni/medicines';
import { newToken, requireAuth } from '../auth/session';

const FAMILY_ROLES = ['family_member', 'patient', 'representative'] as const;
const STATE_TTL_S = 600;
const stateKey = (state: string) => `tomoni:bb-state:${createHash('sha256').update(state).digest('hex')}`;
const iso = (d: Date | string | null) => (d === null ? null : typeof d === 'string' ? d : d.toISOString());

type WarningRow = {
  id: string;
  patient_id: string;
  type: WarningItem['type'];
  access_status: AccessStatus;
  days_until_problem: number;
  problem_date: string;
  medication_id: string | null;
  source_kind: WarningItem['source']['kind'];
  source_date: string;
  evidence: Record<string, unknown>;
  label: string | null;
  fill_source: string | null;
  status: 'open' | 'resolved';
  created_at: string | Date;
};
const WARNING_SQL = sql`
  SELECT w.id, w.patient_id, w.type, w.access_status, w.days_until_problem, w.problem_date::text,
         w.medication_id, w.source_kind, w.source_date::text, w.evidence, w.status, w.created_at,
         v.label, f.source AS fill_source
    FROM care.warning w
    LEFT JOIN care.data_file_version v ON w.source_kind = 'data_file' AND v.id::text = w.source_ref
    LEFT JOIN care.fill f ON w.source_kind = 'fill' AND f.id::text = w.source_ref`;

const toItem = (r: WarningRow): WarningItem => ({
  id: r.id,
  patientId: r.patient_id,
  type: r.type,
  access: r.access_status,
  daysUntilProblem: r.days_until_problem,
  problemDate: r.problem_date,
  medicationId: r.medication_id,
  drug: typeof r.evidence.drug === 'string' ? r.evidence.drug : null,
  // Data files carry their own label; fills say where the claim came from (the web app words it).
  source: {
    kind: r.source_kind,
    date: r.source_date,
    label: r.label ?? `claims:${r.fill_source ?? 'unknown'}`,
  },
  facts: WarningFacts.parse(r.evidence),
});

/** Patients this request may see as family: its own household(s) or itself, never a staff view. */
const familyPatients = (db: Db, s: RequestScope) =>
  db
    .select({ id: schema.patient.id, name: schema.patient.name, preferredName: schema.patient.preferredName })
    .from(schema.patient)
    .where(
      or(
        s.householdIds.length ? inArray(schema.patient.householdId, s.householdIds) : sql`false`,
        s.patientIds.length ? inArray(schema.patient.id, s.patientIds) : sql`false`,
      ),
    )
    .orderBy(schema.patient.birthYear);

export const familyRoutes =
  (deps: {
    redis: Redis;
    queue: Queue;
    publicOrigin: string;
    blueButton?: BlueButton;
  }): FastifyPluginAsyncZod =>
  async (app) => {
    let bb = deps.blueButton;
    const blueButton = () => (bb ??= blueButtonFromEnv());
    const redirectUri = `${deps.publicOrigin}/api/bluebutton/callback`;
    const guard = requireAuth({ roles: [...FAMILY_ROLES] });

    app.get(
      '/api/family/card',
      { preHandler: guard, schema: { tags: ['family'], response: { 200: FamilyCard } } },
      async (req) => {
        const scope = req.auth!.scope;
        const asOf = today();
        return withScope('app', scope, async (db) => {
          const people = await familyPatients(db, scope);
          const ids = people.map((p) => p.id);
          if (!ids.length) return { asOf, patients: [] };
          const meds = (
            await db.execute<{ id: string; patient_id: string; name: string; run_out: string | null }>(sql`
              SELECT m.id, m.patient_id, m.display_name AS name, (lf.fill_date + lf.days_supply)::text AS run_out
                FROM care.medication m
                LEFT JOIN LATERAL (SELECT fill_date, days_supply FROM care.fill f WHERE f.medication_id = m.id
                                    ORDER BY fill_date DESC, id DESC LIMIT 1) lf ON true
               WHERE m.active AND m.patient_id = ANY(${sql.param(ids)}::uuid[])
                 AND (lf.fill_date IS NULL OR lf.fill_date + lf.days_supply >= ${asOf}::date - 30)
               ORDER BY m.display_name`)
          ).rows;
          const warnings = (
            await db.execute<WarningRow>(sql`${WARNING_SQL}
               WHERE w.status = 'open' AND w.patient_id = ANY(${sql.param(ids)}::uuid[])
                 AND w.type <> 'gene_drug_mismatch' -- gene-drug warnings go to the doctor only (§5.7)
               ORDER BY w.days_until_problem, w.type`)
          ).rows.map(toItem);
          const links = await db
            .select()
            .from(schema.bluebuttonLink)
            .where(and(inArray(schema.bluebuttonLink.patientId, ids), sql`revoked_at IS NULL`));
          for (const id of ids)
            await audit(db, {
              action: 'read',
              entityType: 'family_card',
              patientId: id,
              purpose: 'treatment',
            });

          return {
            asOf,
            patients: people.map((p) => {
              const ws = warnings.filter((w) => w.patientId === p.id);
              const link = links.find((l) => l.patientId === p.id);
              return {
                id: p.id,
                name: p.preferredName ?? p.name,
                access: worst(ws.map((w) => w.access)),
                medicare: link ? { mode: link.mode, lastSyncedAt: iso(link.lastSyncedAt) } : null,
                medicines: meds
                  .filter((m) => m.patient_id === p.id)
                  .map((m) => ({
                    id: m.id,
                    name: m.name,
                    runOutDate: m.run_out,
                    access: worst(ws.filter((w) => w.medicationId === m.id).map((w) => w.access)),
                  })),
                warnings: ws,
              };
            }),
          };
        });
      },
    );

    app.get(
      '/api/warnings/:id',
      {
        preHandler: requireAuth(),
        schema: {
          tags: ['family'],
          params: z.object({ id: z.uuid() }),
          response: { 200: WarningEvidence, 404: ErrorBody },
        },
      },
      async (req, reply) => {
        const found = await withScope('app', req.auth!.scope, async (db) => {
          const [r] = (await db.execute<WarningRow>(sql`${WARNING_SQL} WHERE w.id = ${req.params.id}`)).rows;
          if (!r) return null;
          if (r.type === 'gene_drug_mismatch' && !req.auth!.scope.staffRoles.includes('physician'))
            return null;
          const [p] = await db
            .select({ name: schema.patient.name, preferredName: schema.patient.preferredName })
            .from(schema.patient)
            .where(eq(schema.patient.id, r.patient_id));
          const ev = r.evidence;
          const fillIds = [ev.fillId, ...(Array.isArray(ev.fillIds) ? ev.fillIds : [])].filter(
            (x): x is string => typeof x === 'string',
          );
          const fills = fillIds.length
            ? (
                await db.execute<z.infer<typeof WarningEvidence>['fills'][number]>(sql`
                  SELECT f.id, f.fill_date::text AS "fillDate", f.days_supply AS "daysSupply", f.quantity::text AS quantity,
                         f.ndc, coalesce(m.display_name, d.name, f.ndc) AS drug, ph.name AS pharmacy,
                         f.source, f.source_ref AS "sourceRef"
                    FROM care.fill f
                    LEFT JOIN care.medication m ON m.id = f.medication_id
                    LEFT JOIN care.drug d ON d.ndc = f.ndc
                    LEFT JOIN care.pharmacy ph ON ph.id = f.pharmacy_id
                   WHERE f.id = ANY(${sql.param(fillIds)}::uuid[]) ORDER BY f.fill_date DESC`)
              ).rows
            : [];
          const roles = (['before', 'after'] as const).flatMap((role) => {
            const v = ev[role] as { versionId?: unknown } | undefined;
            return typeof v?.versionId === 'string' ? [{ role, id: v.versionId }] : [];
          });
          const files = roles.length
            ? (
                await db
                  .select()
                  .from(schema.dataFileVersion)
                  .where(
                    inArray(
                      schema.dataFileVersion.id,
                      roles.map((x) => x.id),
                    ),
                  )
              ).map((v) => ({
                id: v.id,
                role: roles.find((x) => x.id === v.id)!.role,
                kind: v.kind,
                label: v.label,
                sourceUrl: v.sourceUrl,
                effectiveDate: v.effectiveDate,
                sha256: v.sha256.toString('hex'),
                loadedAt: v.loadedAt.toISOString(),
                rowCount: v.rowCount,
                droppedCount: v.droppedCount,
              }))
            : [];
          await audit(db, {
            action: 'read',
            entityType: 'warning',
            entityId: r.id,
            patientId: r.patient_id,
            purpose: 'treatment',
          });
          return {
            warning: {
              ...toItem(r),
              status: r.status,
              createdAt: new Date(r.created_at).toISOString(),
              patientName: p?.preferredName ?? p?.name ?? '',
            },
            fills,
            files: files.sort((a, b) => a.role.localeCompare(b.role)),
          };
        });
        if (!found) return reply.code(404).send({ error: 'not_found', message: 'No such warning.' });
        return found;
      },
    );

    // ── Blue Button: connect (start OAuth) and callback ─────────────────────
    app.post(
      '/api/patients/:id/bluebutton/connect',
      {
        preHandler: guard,
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        schema: {
          tags: ['family'],
          params: z.object({ id: z.uuid() }),
          response: { 200: BlueButtonConnect, 404: ErrorBody },
        },
      },
      async (req, reply) => {
        const a = req.auth!;
        const mine = await withScope('app', a.scope, (db) => familyPatients(db, a.scope));
        if (!mine.some((p) => p.id === req.params.id))
          return reply.code(404).send({ error: 'not_found', message: 'No such patient.' });
        const state = newToken();
        const { verifier, challenge } = pkce();
        await deps.redis.set(
          stateKey(state),
          JSON.stringify({ patientId: req.params.id, userId: a.userId, verifier }),
          'EX',
          STATE_TTL_S,
        );
        const bb = blueButton();
        return {
          authorizeUrl: bb.authorizeUrl({ state, codeChallenge: challenge, redirectUri }),
          mode: bb.mode,
        };
      },
    );

    // CMS redirects here cross-site, so the SameSite=Strict session cookie is not sent. The
    // single-use, 10-minute, 256-bit state is what binds this callback to the user who started it.
    app.get(
      '/api/bluebutton/callback',
      {
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        schema: {
          tags: ['family'],
          querystring: z.object({
            code: z.string().min(1).max(512).optional(),
            state: z.string().min(1).max(128),
            error: z.string().max(100).optional(),
          }),
        },
      },
      async (req, reply) => {
        const back = (result: string) =>
          reply.code(303).header('location', `/family?medicare=${result}`).send();
        const raw = await deps.redis.getdel(stateKey(req.query.state));
        if (!raw) return back('expired');
        const st = z
          .object({ patientId: z.uuid(), userId: z.uuid(), verifier: z.string() })
          .parse(JSON.parse(raw));
        if (req.query.error || !req.query.code) return back('declined');

        const { rows } = await pool('app').query<{ g: RoleGrant[] }>('SELECT auth.user_grants($1) AS g', [
          st.userId,
        ]);
        const scope = scopeFromGrants(st.userId, rows[0]?.g ?? []);
        const bb = blueButton();
        try {
          const mbi = await withScope('app', scope, async (db) => {
            const [p] = await db
              .select({ mbi: schema.patient.mbi })
              .from(schema.patient)
              .where(eq(schema.patient.id, st.patientId));
            return p?.mbi ?? null;
          });
          const t = await bb.exchange({
            code: req.query.code,
            codeVerifier: st.verifier,
            redirectUri,
            ...(bb.mode === 'mock' && mbi ? { mockBeneficiaryId: mockBeneficiaryId(mbi) } : {}),
          });
          await withScope('app', scope, async (db) => {
            const row = {
              mode: bb.mode,
              fhirPatientId: t.fhirPatientId,
              accessToken: t.accessToken,
              refreshToken: t.refreshToken,
              expiresAt: t.expiresAt,
              scope: t.scope,
              connectedBy: st.userId,
              connectedAt: new Date(),
              revokedAt: null,
            };
            await db
              .insert(schema.bluebuttonLink)
              .values({ patientId: st.patientId, ...row })
              .onConflictDoUpdate({ target: schema.bluebuttonLink.patientId, set: row });
            await audit(db, {
              action: 'consent_change',
              entityType: 'bluebutton_link',
              entityId: st.patientId,
              patientId: st.patientId,
              purpose: 'treatment',
              details: { mode: bb.mode, connected: true },
            });
          });
        } catch (err) {
          req.log.warn({ err: (err as Error).message.slice(0, 120) }, 'bluebutton connect failed');
          return back('failed');
        }
        await deps.queue.add('bluebutton.sync', { patientId: st.patientId });
        return back('connected');
      },
    );
  };
