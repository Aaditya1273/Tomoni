/**
 * One call turn against the database: load the call, run the state machine, write flags with
 * their outbox events and audit rows, and save the call, all in the caller's transaction.
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
    public code: 'not_found' | 'no_contact_consent' | 'ended',
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
  const { rows } = await db.execute<{ practice: string; doctor: string | null; speech: boolean }>(sql`
    SELECT pr.name AS practice, research.has_active_consent(${patientId}, 'speech_task') AS speech,
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
  return {
    patientName: p.preferredName ?? p.name.split(' ')[0] ?? p.name,
    doctorName: rows[0]?.doctor ?? 'your doctor',
    practiceName: rows[0]?.practice ?? 'your practice',
    locale: p.locale,
    recordingAllowed: consent.recordingAllowed,
    upcoming,
    speechTask: rows[0]?.speech === true,
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

export async function callTurn(
  db: Db,
  callId: string,
  text: string,
  llm: ConversationLLM,
  channel: 'simulator' | 'voice',
) {
  const [c] = await db.select().from(schema.call).where(eq(schema.call.id, callId));
  if (!c) throw new CallError('not_found', 'No such call.');
  if (c.step === 'ended') throw new CallError('ended', 'This call has ended.');
  const stored = c.slots as unknown as Stored;
  const prev: CallState = {
    ...stored.state,
    step: c.step as CallState['step'],
    outcome: null,
    turns: JSON.parse(c.transcript ?? '[]'),
  };
  // The items offered at the start stay fixed for the whole call.
  const { practiceId, householdId, ...ctx } = await contextFor(db, c.patientId);
  const r = await takeTurn(prev, { ...ctx, upcoming: stored.upcoming }, text, llm);

  const flags = [];
  for (const f of r.flags)
    flags.push(
      await raiseFlag(db, { ...f, patientId: c.patientId, callId, channel, practiceId, householdId }),
    );

  const ended = r.state.step === 'ended';
  const speech = r.state.slots.speech;
  // Research (rule 2.8, D-009): the sample goes to the research schema under a pseudonym, and
  // its seconds are kept out of care time. Null when consent is gone by now: nothing is stored.
  if (speech?.status === 'done' && !prev.slots.speech?.status)
    await db.execute(
      sql`SELECT research.record_speech_sample(${callId}, 'describe_yesterday', 1, ${speech.ms ?? 0})`,
    );
  const researchSeconds = Math.round((speech?.ms ?? 0) / 1000);
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
  };
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
