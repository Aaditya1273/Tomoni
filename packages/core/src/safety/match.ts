/**
 * The safety matcher (BUILD_PROMPT rule 2.1, ARCHITECTURE "safety"). Pure and synchronous: it
 * runs on every caller utterance before any LLM sees it, and again on everything the LLM
 * returns. Every language's rules run on every utterance, because families switch languages
 * mid-sentence.
 */
import { normalizeText } from './normalize';
import { NEGATORS_AFTER, NEGATORS_BEFORE, RULES, type Lang, type SafetyClass } from './rules';

export interface SafetyHit {
  class: SafetyClass;
  ruleId: string;
  lang: Lang;
  /** The matched phrase as normalized; short, for the flag excerpt. */
  phrase: string;
  /** An emergency phrase the caller denied ("no chest pain") is kept, downgraded to a symptom. */
  negated: boolean;
}

const SEVERITY: Record<SafetyClass, number> = {
  emergency: 0,
  self_harm: 0,
  symptom: 2,
  medication_change: 3,
};

interface Compiled {
  rule: (typeof RULES)[number];
  native: string[];
  latin: RegExp | null;
}
const COMPILED: Compiled[] = RULES.map((rule) => ({
  rule,
  native: (rule.native ?? []).map(normalizeText),
  latin: rule.latin?.length
    ? new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${rule.latin.join('|')})(?![\\p{L}\\p{M}\\p{N}])`, 'gu')
    : null,
}));

const words = (s: string) => s.split(' ').filter(Boolean);
function denied(text: string, start: number, end: number): boolean {
  const before = words(text.slice(0, start)).slice(-2);
  const after = words(text.slice(end)).slice(0, 2);
  return before.some((w) => NEGATORS_BEFORE.includes(w)) || after.some((w) => NEGATORS_AFTER.includes(w));
}

/** All hits, most severe first. An empty array means nothing to escalate. */
export function matchSafety(input: string): SafetyHit[] {
  const text = normalizeText(input);
  if (!text) return [];
  const hits: SafetyHit[] = [];
  const add = (c: Compiled, start: number, phrase: string) => {
    const negated = c.rule.class === 'emergency' && denied(text, start, start + phrase.length);
    hits.push({
      class: negated ? 'symptom' : c.rule.class,
      ruleId: c.rule.id,
      lang: c.rule.lang,
      phrase,
      negated,
    });
  };
  for (const c of COMPILED) {
    for (const p of c.native) {
      const at = text.indexOf(p);
      if (at >= 0) add(c, at, p);
    }
    if (c.latin) for (const m of text.matchAll(c.latin)) add(c, m.index, m[0]);
  }
  return hits.sort((a, b) => SEVERITY[a.class] - SEVERITY[b.class]);
}

/** The single class that decides what happens next, or null. */
export const topClass = (hits: SafetyHit[]): SafetyClass | null => hits[0]?.class ?? null;
