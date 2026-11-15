/**
 * The conversation LLM fills typed slots and nothing else (BUILD_PROMPT §3, rule 2.1). Two
 * implementations: `ClaudeLLM` (Anthropic API, versioned prompt file) and `MockLLM` (rules).
 * Whatever comes back is schema-checked; anything off-schema becomes "unclear".
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { normalizeText } from '@tomoni/core';

export const SLOTS = {
  wellbeing: z.object({
    mood: z.enum(['good', 'okay', 'unwell', 'unclear']),
    symptomMentioned: z.string().max(200).nullable(),
  }),
  meds: z.object({ medsTaken: z.enum(['yes', 'no', 'some', 'unclear']) }),
  upcoming: z.object({ response: z.enum(['wants_help', 'no_thanks', 'unclear']) }),
} as const;
export type SlotStep = keyof typeof SLOTS;
export type Slots<S extends SlotStep> = z.infer<(typeof SLOTS)[S]>;

export const UNCLEAR: { [S in SlotStep]: Slots<S> } = {
  wellbeing: { mood: 'unclear', symptomMentioned: null },
  meds: { medsTaken: 'unclear' },
  upcoming: { response: 'unclear' },
};

export interface ConversationLLM {
  readonly promptVersion: string;
  fill<S extends SlotStep>(step: S, utterance: string, locale: string): Promise<Slots<S>>;
}

const PROMPT_FILE = 'slot-filler.v1.md';
export const PROMPT_VERSION = PROMPT_FILE.replace(/\.md$/, '');
const PROMPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

export class ClaudeLLM implements ConversationLLM {
  readonly promptVersion = PROMPT_VERSION;
  private readonly system = readFileSync(path.join(PROMPTS, PROMPT_FILE), 'utf8');

  constructor(
    private readonly client: Anthropic = new Anthropic(),
    private readonly model = process.env.TOMONI_LLM_MODEL ?? 'claude-opus-5-5',
  ) {}

  async fill<S extends SlotStep>(step: S, utterance: string, locale: string): Promise<Slots<S>> {
    // Caller text goes in as tagged data; the system prompt says it is never instructions.
    const safe = utterance.replaceAll('<', '‹').replaceAll('>', '›').slice(0, 1000);
    try {
      const res = await this.client.messages.parse(
        {
          model: this.model,
          max_tokens: 1024,
          system: this.system,
          output_config: { effort: 'low', format: zodOutputFormat(SLOTS[step]) },
          messages: [
            {
              role: 'user',
              content: `<step>${step}</step>\n<locale>${locale}</locale>\n<caller_utterance>${safe}</caller_utterance>`,
            },
          ],
        },
        { timeout: 8_000, maxRetries: 1 },
      );
      // A refusal or truncated output is not an answer: the scripted call treats it as unclear.
      if (res.stop_reason !== 'end_turn' || !res.parsed_output) return UNCLEAR[step];
      const checked = SLOTS[step].safeParse(res.parsed_output);
      return checked.success ? (checked.data as Slots<S>) : UNCLEAR[step];
    } catch {
      return UNCLEAR[step]; // the call goes on without the LLM rather than stall on the line
    }
  }
}

const YES = [
  'yes',
  'yeah',
  'yep',
  'yup',
  'sure',
  'ok',
  'okay',
  'haan',
  'han',
  'ha',
  'haa',
  'ji',
  'ho',
  'hoy',
  'aam',
  'aama',
  'hya',
  'ha ji',
  'हाँ',
  'हां',
  'जी',
  'હા',
  'ஆம்',
  'ஆமா',
  'ਹਾਂ',
  'ਹਾਂਜੀ',
  'হ্যাঁ',
  'হ্যা',
];
const NO = [
  'no',
  'nope',
  'not',
  'nahi',
  'nahin',
  'nai',
  'na',
  'nathi',
  'illai',
  'illa',
  'नहीं',
  'नही',
  'ना',
  'ના',
  'નથી',
  'இல்லை',
  'ਨਹੀਂ',
  'না',
  'নেই',
];
const SOME = ['some', 'few', 'half', 'kuch', 'thodi', 'थोड़ी', 'कुछ'];
const GOOD = [
  'fine',
  'okay',
  'ok',
  'alright',
  'good',
  'great',
  'well',
  'better',
  'theek',
  'thik',
  'accha',
  'achha',
  'saru',
  'saras',
  'majama',
  'maja',
  'nalla',
  'nallaa',
  'bhalo',
  'changa',
  'ठीक',
  'अच्छा',
  'સારું',
  'મજામાં',
  'நல்ல',
  'நன்றாக',
  'ভালো',
  'ਚੰਗਾ',
  'ਠੀਕ',
];

/** Keyword slot filler for tests, CI and the simulator when no API key is set. */
export class MockLLM implements ConversationLLM {
  readonly promptVersion = 'mock-rules.v1';

  async fill<S extends SlotStep>(step: S, utterance: string): Promise<Slots<S>> {
    const t = normalizeText(utterance);
    const words = new Set(t.split(' '));
    const has = (xs: string[]) => xs.some((x) => (x.includes(' ') ? t.includes(x) : words.has(x)));
    const no = has(NO);
    const out =
      step === 'wellbeing'
        ? { mood: has(GOOD) && !no ? 'good' : has(GOOD) ? 'okay' : 'unclear', symptomMentioned: null }
        : step === 'meds'
          ? { medsTaken: has(SOME) ? 'some' : no ? 'no' : has(YES) ? 'yes' : 'unclear' }
          : { response: no ? 'no_thanks' : has(YES) ? 'wants_help' : 'unclear' };
    return SLOTS[step].parse(out) as Slots<S>;
  }
}

export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): ConversationLLM {
  return env.TOMONI_ADAPTER_LLM === 'real' ? new ClaudeLLM() : new MockLLM();
}
