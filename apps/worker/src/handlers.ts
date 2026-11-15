import { eq, sql } from 'drizzle-orm';
import { systemScope } from '@tomoni/core';
import type { JobData, JobName } from '@tomoni/contracts';
import { pool, schema, withScope } from '@tomoni/db';
import { blueButtonFromEnv, ingestBundles, runEngine, today, type BlueButton } from '@tomoni/medicines';
import { audit } from '@tomoni/db';
import { callKey, isDue, line, SCRIPT_VERSION, telephonyFromEnv, type Telephony } from '@tomoni/voice';
import type { Queue } from 'bullmq';
import { MockERx, MockPharmacyPortal, runAction } from '@tomoni/agent';

let bb: BlueButton | undefined;
const blueButton = () => (bb ??= blueButtonFromEnv());
let tel: Telephony | undefined;
const telephony = () => (tel ??= telephonyFromEnv());
const publicApi = () =>
  process.env.TOMONI_PUBLIC_API_ORIGIN ?? `http://localhost:${process.env.API_PORT ?? 4000}`;

/** Set by main.ts: jobs that fan out (the scheduler) enqueue through it. */
export const deps: { queue: Queue | null } = { queue: null };

export const handlers: { [N in JobName]: (data: JobData<N>) => Promise<unknown> } = {
  async 'audit.seal'() {
    const { rows } = await pool('worker').query<{ n: number }>('SELECT audit.seal(5000) AS n');
    return { sealed: rows[0]?.n ?? 0 };
  },

  'engine.run': ({ patientIds }) =>
    withScope('worker', systemScope('engine'), (db) =>
      runEngine(db, { today: today(), ...(patientIds ? { patientIds } : {}) }),
    ),

  async 'bluebutton.sync'({ patientId }) {
    const adapter = blueButton();
    const scope = systemScope('bluebutton.sync');
    const link = await withScope('worker', scope, async (db) => {
      const [l] = await db
        .select()
        .from(schema.bluebuttonLink)
        .where(eq(schema.bluebuttonLink.patientId, patientId));
      return l;
    });
    if (!link || link.revokedAt) return { skipped: 'not connected' };
    if (link.mode !== adapter.mode) return { skipped: `link is ${link.mode}, adapter is ${adapter.mode}` };

    let tokens = {
      fhirPatientId: link.fhirPatientId,
      accessToken: link.accessToken,
      refreshToken: link.refreshToken,
      expiresAt: link.expiresAt,
      scope: link.scope,
    };
    if (tokens.expiresAt && tokens.expiresAt.getTime() < Date.now() + 60_000)
      tokens = await adapter.refresh(tokens);
    // The mock's data is a snapshot as of the day the family connected, so re-syncs are idempotent.
    const asOf = adapter.mode === 'mock' ? link.connectedAt.toISOString().slice(0, 10) : today();
    const bundles = await adapter.fetchBundles(tokens, asOf); // network call outside any DB transaction

    return withScope('worker', scope, async (db) => {
      const r = await ingestBundles(db, patientId, bundles, adapter.mode === 'mock' ? 'mock' : 'bluebutton');
      await db
        .update(schema.bluebuttonLink)
        .set({
          lastSyncedAt: sql`now()`,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        })
        .where(eq(schema.bluebuttonLink.patientId, patientId));
      const engine = await runEngine(db, { today: today(), patientIds: [patientId] });
      return { ...r, warnings: engine.open };
    });
  },

  /** Every 5 minutes: create today's call for each consented patient whose window is open now. */
  async 'call.schedule'() {
    const scope = systemScope('call.schedule');
    const now = new Date();
    const created = await withScope('worker', scope, async (db) => {
      const { rows } = await db.execute<{
        id: string;
        tz: string;
        locale: string;
        ws: string;
        we: string;
        qs: string;
        qe: string;
      }>(sql`
        SELECT p.id, p.tz, p.locale, p.call_window_start::text AS ws, p.call_window_end::text AS we,
               cc.quiet_start::text AS qs, cc.quiet_end::text AS qe
          FROM care.patient p
          JOIN care.contact_consent cc ON cc.patient_id = p.id AND cc.channel = 'voice' AND cc.withdrawn_at IS NULL
         WHERE p.status = 'active'`);
      const ids: string[] = [];
      for (const r of rows) {
        const d = isDue(
          { patientId: r.id, tz: r.tz, windowStart: r.ws, windowEnd: r.we, quietStart: r.qs, quietEnd: r.qe },
          now,
        );
        if (!d.due) continue;
        const [c] = await db
          .insert(schema.call)
          .values({
            patientId: r.id,
            channel: 'voice',
            scheduledFor: now,
            locale: r.locale,
            scriptVersion: SCRIPT_VERSION,
            idempotencyKey: callKey(r.id, d.localDate),
          })
          .onConflictDoNothing({ target: schema.call.idempotencyKey })
          .returning({ id: schema.call.id });
        if (c) ids.push(c.id);
      }
      return ids;
    });
    for (const callId of created)
      await deps.queue?.add('call.place', { callId }, { jobId: `call-${callId}` });
    return { scheduled: created.length };
  },

  /** Dial one scheduled call. Consent is checked again: it may have been withdrawn since scheduling. */
  async 'call.place'({ callId }) {
    const scope = systemScope('call.place');
    const target = await withScope('worker', scope, async (db) => {
      const [c] = await db.select().from(schema.call).where(eq(schema.call.id, callId));
      if (!c || c.step !== 'scheduled') return null;
      const [p] = await db
        .select({ phone: schema.patient.phone })
        .from(schema.patient)
        .where(eq(schema.patient.id, c.patientId));
      const { rows } = await db.execute<{ ok: boolean }>(sql`
        SELECT EXISTS (SELECT 1 FROM care.contact_consent WHERE patient_id = ${c.patientId}
                         AND channel = 'voice' AND withdrawn_at IS NULL) AS ok`);
      return rows[0]?.ok && p?.phone
        ? { patientId: c.patientId, phone: p.phone }
        : { patientId: c.patientId, phone: null };
    });
    if (!target) return { skipped: 'not scheduled' };
    const t = telephony();
    const r = target.phone
      ? await t.placeCall({
          to: target.phone,
          answerUrl: `${publicApi()}/api/voice/twilio/${callId}/answer`,
          statusUrl: `${publicApi()}/api/voice/twilio/${callId}/status`,
        })
      : { ref: 'no-consent-or-number', dialed: false };
    await withScope('worker', scope, async (db) => {
      await db
        .update(schema.call)
        .set(
          r.dialed
            ? { telephonyRef: r.ref }
            : {
                telephonyRef: r.ref,
                step: 'ended',
                outcome: target.phone ? 'no_answer' : 'failed',
                endedAt: new Date(),
              },
        )
        .where(eq(schema.call.id, callId));
      await audit(db, {
        action: 'update',
        entityType: 'call',
        entityId: callId,
        patientId: target.patientId,
        purpose: 'treatment',
        details: { dialed: r.dialed, mode: t.mode },
      });
    });
    return { dialed: r.dialed, mode: t.mode };
  },

  /** Rule 2.1: an emergency reaches the family as well as the practice. */
  async 'notify.family'({ flagId }) {
    const scope = systemScope('notify.family');
    const plan = await withScope('worker', scope, async (db) => {
      const { rows } = await db.execute<{
        patient_id: string;
        household_id: string;
        practice: string;
        locale: string;
      }>(sql`
        SELECT f.patient_id, p.household_id, pr.name AS practice, h.primary_locale AS locale
          FROM care.nurse_flag f JOIN care.patient p ON p.id = f.patient_id
          JOIN care.practice pr ON pr.id = p.practice_id JOIN care.household h ON h.id = p.household_id
         WHERE f.id = ${flagId} AND f.urgency = 1`);
      const f = rows[0];
      if (!f) return null;
      const [p] = await db
        .select({ name: schema.patient.name, preferred: schema.patient.preferredName })
        .from(schema.patient)
        .where(eq(schema.patient.id, f.patient_id));
      const family = await db
        .select({ id: schema.familyMember.id, phone: schema.familyMember.phone })
        .from(schema.familyMember)
        .where(sql`household_id = ${f.household_id} AND notify_on_emergency AND phone IS NOT NULL`);
      return { ...f, name: p?.preferred ?? p?.name ?? '', family };
    });
    if (!plan) return { skipped: 'not an emergency flag' };
    const t = telephony();
    const body = line(plan.locale, 'familyEmergency', { name: plan.name, practice: plan.practice });
    const results: { member: string; ref: string; sent: boolean }[] = [];
    for (const m of plan.family) results.push({ member: m.id, ...(await t.sendSms({ to: m.phone!, body })) });
    await withScope('worker', scope, (db) =>
      audit(db, {
        action: 'create',
        entityType: 'family_notification',
        entityId: flagId,
        patientId: plan.patient_id,
        purpose: 'treatment',
        details: { recipients: results.length, sent: results.filter((r) => r.sent).length, mode: t.mode },
      }),
    );
    return { recipients: results.length, sent: results.filter((r) => r.sent).length, mode: t.mode };
  },

  /** One agent action: confirm → do → verify; failures retry with backoff, then go to ops. */
  async 'action.run'({ actionId }) {
    // ponytail: mock pharmacy and e-prescribing adapters only; real partners are a Go-Live item.
    const adapters = { pharmacy: new MockPharmacyPortal(), erx: new MockERx() };
    const r = await runAction(
      (fn) => withScope('worker', systemScope('agent'), fn),
      actionId,
      adapters,
      today(),
    );
    if ('retryInMs' in r) await deps.queue?.add('action.run', { actionId }, { delay: r.retryInMs });
    return r;
  },
};
