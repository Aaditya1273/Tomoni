/**
 * One call turn against the database: load the call, run the state machine, write flags with
 * their outbox events and audit rows, and save the call.
 * Shared by the simulator now and the telephony webhooks later.
 */
import { and, eq, sql } from 'drizzle-orm';
import { audit, schema, type Db } from '@tomoni/db';
import {
  SCRIPT_VERSION,
  startCall,
  takeTurn,
  type CallContext,
  type CallState,
  type ConversationLLM,
  type FlagDraft,
  type UpcomingKind,
} from '@tomoni/voice';

/** What the call row keeps between turns. No names: those stay encrypted on the patient row. */
interface Stored {
  state: Omit<CallState, 'turns' | 'step' | 'outcome'>;
  upcoming: CallContext['upcoming'];
}

export class CallError extends Error {
  constructor(
    public code: 'not_found' | 'no_contact_consent' | 'ended' | 'busy',
    message: string,
  ) {
    super(message);
  }
}

/** Short spoken name: "clopidogrel 75 MG Oral Tablet" → "clopidogrel". */
const spoken = (drug: unknown) =>
  typeof drug === 'string' ? (drug.split(/\s\d/)[0] ?? drug).toLowerCase() : '';

async function contextFor(
  db: Db,
  patientId: string,
): Promise<CallContext & { practiceId: string; householdId: string }> {
  const [p] = await db.select().from(schema.patient).where(eq(schema.patient.id, patientId));
  if (!p) throw new CallError('not_found', 'No such patient.');
  const [consent] = await db
    .select()
    .from(schema.contactConsent)
    .where(
      and(
        eq(schema.contactConsent.patientId, patientId),
        eq(schema.contactConsent.channel, 'voice'),
        sql`withdrawn_at IS NULL`,
      ),
    );
  // Rule 2.10: Tomoni calls only people who agreed to be called.
  if (!consent) throw new CallError('no_contact_consent', 'This patient has not agreed to calls.');
  const { rows } = await db.execute<{
    practice: string;
    doctor: string | null;
    speech: boolean;
    region: 'US' | 'IN';
  }>(sql`
    SELECT pr.name AS practice, research.has_active_consent(${patientId}, 'speech_task') AS speech,
           (SELECT region FROM care.household WHERE id = ${p.householdId}) AS region,
           (SELECT display_name FROM care.clinician c WHERE c.practice_id = pr.id AND c.kind = 'physician'
             ORDER BY created_at LIMIT 1) AS doctor
      FROM care.practice pr WHERE pr.id = ${p.practiceId}`);
  const upcoming = (
    await db.execute<{ id: string; type: UpcomingKind; drug: unknown }>(sql`
      SELECT id, type, evidence->'drug' AS drug FROM care.warning
       WHERE patient_id = ${patientId} AND status = 'open' AND access_status IN ('red','amber')
         AND type <> 'gene_drug_mismatch'
       ORDER BY days_until_problem, type LIMIT 2`)
  ).rows.map((w) => ({ kind: w.type, drug: spoken(w.drug), warningId: w.id }));
  // Trial Bridge pre-screen: an open match's approved questions; none without consent (0022).
  const ps = (
    await db.execute<{ match_id: string; questions: { id: string; text: string }[] }>(
      sql`SELECT match_id, questions FROM research.prescreen_for_call(${patientId}, ${p.locale})`,
    )
  ).rows[0];
  return {
    patientName: p.preferredName ?? p.name.split(' ')[0] ?? p.name,
    doctorName: rows[0]?.doctor ?? 'your doctor',
    practiceName: rows[0]?.practice ?? 'your practice',
    locale: p.locale,
    recordingAllowed: consent.recordingAllowed,
    upcoming,
    speechTask: rows[0]?.speech === true,
    region: rows[0]?.region ?? 'US',
    ...(ps ? { prescreen: { matchId: ps.match_id, questions: ps.questions } } : {}),
    practiceId: p.practiceId,
    householdId: p.householdId,
  };
}

/**
 * Open a call: disclosure first (rule 2.10). The simulator creates the row; a phone call opens
 * the row the scheduler made, when the patient answers.
 */
export async function beginCall(
  db: Db,
  o: { patientId: string; llm: ConversationLLM; channel: 'simulator' | 'voice'; callId?: string },
) {
  const { practiceId: _p, householdId: _h, ...ctx } = await contextFor(db, o.patientId);
  const { state, say } = startCall(ctx);
  const stored: Stored = { state: { upcomingIndex: 0, retries: 0, slots: {} }, upcoming: ctx.upcoming };
  const values = {
    startedAt: new Date(),
    locale: ctx.locale,
    scriptVersion: SCRIPT_VERSION,
    promptVersion: o.llm.promptVersion,
    step: state.step,
    slots: stored as never,
    disclosurePlayed: true,
    recordingConsent: ctx.recordingAllowed,
    transcript: JSON.stringify(state.turns),
  };
  const [c] = o.callId
    ? await db
        .update(schema.call)
        .set(values)
        .where(and(eq(schema.call.id, o.callId), eq(schema.call.step, 'scheduled')))
        .returning({ id: schema.call.id })
    : await db
        .insert(schema.call)
        .values({ patientId: o.patientId, channel: o.channel, ...values })
        .returning({ id: schema.call.id });
  if (!c) throw new CallError('ended', 'This call has already started or ended.');
  await audit(db, {
    action: 'create',
    entityType: 'call',
    entityId: c.id,
    patientId: o.patientId,
    purpose: 'treatment',
  });
  return { callId: c.id, say, ended: false, outcome: null, flags: [] };
}

/** Runs one function in its own transaction, under the caller's role and scope. */
export type Tx = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/**
 * One caller turn in two short transactions, with the LLM in between holding no connection: a
 * slow model can't pin a database connection per live call. The write re-reads the row under a
 * lock and refuses if another turn landed meanwhile, so a retried webhook can't apply twice.
 */
export async function callTurn(
  tx: Tx,
  callId: string,
  text: string,
  llm: ConversationLLM,
  channel: 'simulator' | 'voice',
) {
  const { c, ctx, practiceId, householdId } = await tx(async (db) => {
    const [c] = await db.select().from(schema.call).where(eq(schema.call.id, callId));
    if (!c) throw new CallError('not_found', 'No such call.');
    if (c.step === 'ended') throw new CallError('ended', 'This call has ended.');
    const { practiceId, householdId, ...ctx } = await contextFor(db, c.patientId);
    return { c, ctx, practiceId, householdId };
  });
  const stored = c.slots as unknown as Stored;
  const prev: CallState = {
    ...stored.state,
    step: c.step as CallState['step'],
    outcome: null,
    turns: JSON.parse(c.transcript ?? '[]'),
  };
  // The items offered at the start stay fixed for the whole call.
  const r = await takeTurn(prev, { ...ctx, upcoming: stored.upcoming }, text, llm);

  return tx(async (db) => {
    const [now] = await db.select().from(schema.call).where(eq(schema.call.id, callId)).for('update');
    if (!now || now.step !== c.step || now.transcript !== c.transcript)
      throw new CallError('busy', 'Another turn of this call was taken first.');

    const flags = [];
    for (const f of r.flags)
      flags.push(
        await raiseFlag(db, { ...f, patientId: c.patientId, callId, channel, practiceId, householdId }),
      );

    const ended = r.state.step === 'ended';
    const speech = r.state.slots.speech;
    // Research (rule 2.8, D-009): the sample goes to the research schema under a pseudonym, and
    // its seconds are kept out of care time. Null when consent is gone by now: nothing is stored.
    const speechSampleId =
      speech?.status === 'done' && !prev.slots.speech?.status
        ? ((
            await db.execute<{ id: string | null }>(
              sql`SELECT research.record_speech_sample(${callId}, 'describe_yesterday', 1, ${speech.ms ?? 0}) AS id`,
            )
          ).rows[0]?.id ?? null)
        : null;
    // Trial Bridge: a complete pre-screen moves the match (prescreened or ineligible), under the
    // pseudonym; null when the call, consent or match no longer holds.
    const ps = r.state.slots.prescreen;
    const prescreen =
      ps?.status === 'done' && !prev.slots.prescreen?.status
        ? ((
            await db.execute<{ s: string | null }>(
              sql`SELECT research.record_prescreen(${callId}, ${ps.matchId}, ${JSON.stringify(ps.answers)}::jsonb) AS s`,
            )
          ).rows[0]?.s ?? null)
        : null;
    if (prescreen)
      await audit(db, {
        action: 'update',
        entityType: 'trial_match',
        entityId: ps!.matchId,
        patientId: c.patientId,
        purpose: 'research',
        details: { status: prescreen, by: 'voice_prescreen' },
      });
    const researchSeconds = Math.round(((speech?.ms ?? 0) + (ps?.ms ?? 0)) / 1000);
    const { turns: _t, step, outcome, ...rest } = r.state;
    await db
      .update(schema.call)
      .set({
        step,
        outcome,
        slots: { state: rest, upcoming: stored.upcoming } as never,
        transcript: JSON.stringify(r.state.turns),
        ...(ended
          ? {
              endedAt: new Date(),
              careSeconds: sql`greatest(0, extract(epoch FROM now() - started_at)::int - ${researchSeconds})`,
              researchSeconds,
            }
          : {}),
      })
      .where(eq(schema.call.id, callId));
    await audit(db, {
      action: 'update',
      entityType: 'call',
      entityId: callId,
      patientId: c.patientId,
      purpose: 'treatment',
      details: { step, flags: flags.length },
    });
    const before = new Set(prev.slots.helpWanted ?? []);
    const helpWanted = (r.state.slots.helpWanted ?? []).filter((w) => !before.has(w));
    return {
      callId,
      say: r.say,
      ended,
      outcome: ended ? outcome : null,
      flags,
      helpWanted,
      speechTask: step === 'speech_task',
      /** Voice Lab audio (D-032): the task began this turn, or ended (done, skipped or cut short). */
      speechStarted: step === 'speech_task' && prev.step !== 'speech_task',
      speechOver: prev.step === 'speech_task' && step !== 'speech_task',
      speechSampleId,
      prescreen,
    };
  });
}

/** A nurse flag, its live event (no PHI in the payload) and its audit row, in one transaction. */
export async function raiseFlag(
  db: Db,
  f: FlagDraft & {
    patientId: string;
    callId: string | null;
    channel: 'simulator' | 'voice';
    practiceId: string;
    householdId: string;
  },
) {
  const [row] = await db
    .insert(schema.nurseFlag)
    .values({
      patientId: f.patientId,
      callId: f.callId,
      channel: f.channel,
      class: f.class,
      matchedRule: f.ruleId,
      excerpt: f.excerpt,
      urgency: f.urgency,
    })
    .returning({ id: schema.nurseFlag.id });
  await db.insert(schema.outbox).values({
    topic: 'flag.created',
    aggregateType: 'nurse_flag',
    aggregateId: row!.id,
    practiceId: f.practiceId,
    // Emergencies reach the family too (rule 2.1); routine flags stay with the care team.
    householdId: f.urgency === 1 ? f.householdId : null,
    payload: { class: f.class, urgency: f.urgency, patientId: f.patientId },
  });
  await audit(db, {
    action: 'create',
    entityType: 'nurse_flag',
    entityId: row!.id,
    patientId: f.patientId,
    purpose: 'treatment',
    details: { class: f.class, rule: f.ruleId },
  });
  return { id: row!.id, class: f.class, urgency: f.urgency };
}
