/**
 * The daily call as a state machine (BUILD_PROMPT §5.4, rules 2.1 and 2.10).
 *
 *   disclosure+wellbeing → meds → upcoming × n → [speech_task] → closing → ended
 *
 * The speech task is research (rule 2.8): offered only with active speech-task consent, only on a
 * call that ended without a flag, never read by the LLM, and kept out of the care transcript.
 *
 * Every caller utterance goes through the safety matcher BEFORE the LLM sees it. A hit leaves
 * the current task for good: an emergency or self-harm ends the call with the emergency script;
 * a symptom or medication change opens a nurse flag and goes straight to the closing. There is
 * no edge from a fired flag back to an admin step. The LLM's own output is matched again, so it
 * can add a flag but never remove one.
 */
import { matchSafety, topClass, type SafetyClass, type SafetyHit } from '@tomoni/core';
import { UNCLEAR, type ConversationLLM, type SlotStep } from './llm';
import { itemLine as itemFor, line as lineFor, type Region, type UpcomingKind } from './scripts';

export type Step = 'wellbeing' | 'meds' | 'upcoming' | 'speech_task' | 'ended';
export type Outcome = 'completed' | 'escalated';

export interface CallContext {
  patientName: string;
  doctorName: string;
  practiceName: string;
  locale: string;
  recordingAllowed: boolean;
  upcoming: { kind: UpcomingKind; drug: string; warningId: string }[];
  /** Active research consent with the speech-task scope, checked live on every turn. */
  speechTask?: boolean;
  /** The household's region: India gets its own emergency numbers and family-led help. */
  region?: Region;
}

export interface Turn {
  who: 'tomoni' | 'caller';
  text: string;
  at: string;
}

export interface FlagDraft {
  class: SafetyClass;
  ruleId: string;
  excerpt: string;
  urgency: 1 | 2 | 3;
}

export interface CallState {
  step: Step;
  upcomingIndex: number;
  retries: number;
  slots: {
    mood?: string;
    symptomMentioned?: string | null;
    medsTaken?: string;
    helpWanted?: string[]; // warning ids the patient asked Tomoni to help with
    declined?: string[];
    /** Research only: when the task was offered, and how it went. Never the words. */
    speech?: { offeredAt: string; status?: 'done' | 'skipped'; ms?: number };
  };
  turns: Turn[];
  outcome: Outcome | null;
}

export interface TurnResult {
  state: CallState;
  say: string[];
  flags: FlagDraft[];
}

const URGENCY: Record<SafetyClass, 1 | 2 | 3> = {
  emergency: 1,
  self_harm: 1,
  symptom: 2,
  medication_change: 2,
};
const now = () => new Date().toISOString();
const line = (ctx: CallContext, key: Parameters<typeof lineFor>[1], vars?: Record<string, string>) =>
  lineFor(ctx.locale, key, vars, ctx.region);
const itemLine = (ctx: CallContext, kind: UpcomingKind, drug: string) =>
  itemFor(ctx.locale, kind, drug, ctx.region);
const SKIP = /^(skip|no|no thanks|not today|नहीं|छोड़ो|छोड़िए|आज नहीं)[\s.!।]*$/i;

/** Opening: the AI disclosure always comes first (rule 2.10), then the first question. */
export function startCall(ctx: CallContext): { state: CallState; say: string[] } {
  const say = [
    line(ctx, 'disclosure', {
      name: ctx.patientName,
      doctor: ctx.doctorName,
      practice: ctx.practiceName,
      recording: line(ctx, ctx.recordingAllowed ? 'recordingOn' : 'recordingOff'),
    }),
    line(ctx, 'wellbeing'),
  ];
  return {
    state: {
      step: 'wellbeing',
      upcomingIndex: 0,
      retries: 0,
      slots: {},
      turns: say.map((text) => ({ who: 'tomoni', text, at: now() })),
      outcome: null,
    },
    say,
  };
}

function flagFrom(hits: SafetyHit[], utterance: string): FlagDraft {
  const top = hits[0]!;
  return {
    class: top.class,
    ruleId: top.ruleId,
    excerpt: utterance.slice(0, 500),
    urgency: URGENCY[top.class],
  };
}

export async function takeTurn(
  prev: CallState,
  ctx: CallContext,
  utterance: string,
  llm: ConversationLLM,
): Promise<TurnResult> {
  if (prev.step === 'ended') throw new Error('call has ended');
  const state: CallState = structuredClone(prev);
  const say: string[] = [];
  const flags: FlagDraft[] = [];
  const v = { name: ctx.patientName, practice: ctx.practiceName };
  state.turns.push({ who: 'caller', text: utterance, at: now() });

  const end = (outcome: Outcome) => {
    state.step = 'ended';
    state.outcome = outcome;
  };
  const close = () => {
    say.push(line(ctx, 'closing', v));
    end('completed');
  };
  // A clean finish may offer the research task; a flagged call goes straight to close().
  const finish = () => {
    if (!ctx.speechTask || state.slots.speech) return close();
    state.step = 'speech_task';
    state.slots.speech = { offeredAt: now() };
    say.push(line(ctx, 'speechTask'));
  };

  // 1. Safety first, on the raw words.
  const hits = matchSafety(utterance);
  const cls = topClass(hits);
  if (cls === 'emergency' || cls === 'self_harm') {
    flags.push(flagFrom(hits, utterance));
    say.push(line(ctx, cls === 'self_harm' ? 'selfHarm' : 'emergency', v));
    end('escalated');
  } else if (cls) {
    flags.push(flagFrom(hits, utterance));
    say.push(line(ctx, 'flagged', v));
    close();
  } else if (state.step === 'speech_task') {
    // Research words: no LLM, and the care transcript keeps a marker instead of them.
    const sp = state.slots.speech!;
    sp.status = SKIP.test(utterance.trim()) ? 'skipped' : 'done';
    sp.ms = sp.status === 'done' ? Math.min(120_000, Date.now() - Date.parse(sp.offeredAt)) : 0;
    state.turns[state.turns.length - 1]!.text = '[research speech task]';
    if (sp.status === 'done') say.push(line(ctx, 'speechThanks'));
    close();
  } else {
    // 2. Only now may the LLM read it, and only to fill this step's slots.
    const step = state.step as SlotStep;
    const slots = await llm.fill(step, utterance, ctx.locale);
    const unclear = JSON.stringify(slots) === JSON.stringify(UNCLEAR[step]);

    // 3. The LLM's output is checked too: it can raise a flag, never lower one.
    const said = 'symptomMentioned' in slots ? slots.symptomMentioned : null;
    const second = said ? matchSafety(said) : [];
    if (step === 'wellbeing' && (second.length || ('mood' in slots && slots.mood === 'unwell'))) {
      const c = topClass(second);
      flags.push({
        class: c === 'emergency' || c === 'self_harm' ? c : 'symptom',
        ruleId: second[0] ? `llm:${second[0].ruleId}` : 'llm:mood_unwell',
        excerpt: utterance.slice(0, 500),
        urgency: c === 'emergency' || c === 'self_harm' ? 1 : 3,
      });
      if (c === 'emergency' || c === 'self_harm') {
        say.push(line(ctx, c === 'self_harm' ? 'selfHarm' : 'emergency', v));
        end('escalated');
      } else {
        say.push(line(ctx, 'flagged', v));
        close();
      }
    } else if (unclear && state.retries === 0) {
      state.retries = 1;
      say.push(line(ctx, 'unclear'), lastQuestion(state, ctx));
    } else {
      state.retries = 0;
      if (step === 'wellbeing' && 'mood' in slots) {
        state.slots.mood = slots.mood;
        state.step = 'meds';
        say.push(line(ctx, 'meds'));
      } else if (step === 'meds' && 'medsTaken' in slots) {
        state.slots.medsTaken = slots.medsTaken;
        if (slots.medsTaken === 'no' || slots.medsTaken === 'some') say.push(line(ctx, 'medsMissed'));
        else if (slots.medsTaken === 'yes') say.push(line(ctx, 'medsThanks'));
        nextUpcoming(state, ctx, say, finish);
      } else if (step === 'upcoming' && 'response' in slots) {
        const item = ctx.upcoming[state.upcomingIndex]!;
        if (slots.response === 'wants_help') {
          (state.slots.helpWanted ??= []).push(item.warningId);
          say.push(line(ctx, 'upcomingHelp'));
        } else {
          (state.slots.declined ??= []).push(item.warningId);
          say.push(line(ctx, 'upcomingNoThanks'));
        }
        state.upcomingIndex++;
        nextUpcoming(state, ctx, say, finish);
      }
    }
  }

  for (const text of say) state.turns.push({ who: 'tomoni', text, at: now() });
  return { state, say, flags };
}

function nextUpcoming(state: CallState, ctx: CallContext, say: string[], finish: () => void) {
  const item = ctx.upcoming[state.upcomingIndex];
  if (!item) return finish();
  state.step = 'upcoming';
  say.push(line(ctx, 'upcoming', { item: itemLine(ctx, item.kind, item.drug) }));
}

function lastQuestion(state: CallState, ctx: CallContext): string {
  if (state.step === 'wellbeing') return line(ctx, 'wellbeing');
  if (state.step === 'meds') return line(ctx, 'meds');
  const item = ctx.upcoming[state.upcomingIndex]!;
  return line(ctx, 'upcoming', { item: itemLine(ctx, item.kind, item.drug) });
}
