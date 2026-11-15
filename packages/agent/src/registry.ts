/**
 * The skill registry (rule 2.2): the only things the agent can do. Each skill is typed and
 * versioned, declares who must approve it (rule 2.3: money or a prescription → family;
 * clinical → physician), which adapters it may use, and its confirm → do → verify steps.
 * Nothing diagnoses, doses, chooses a drug or answers a symptom: those are never automated.
 */
import { z } from 'zod';
import type { Adapters } from './adapters';

export type ApprovalClass = 'none' | 'family' | 'physician';
type Json = Record<string, unknown>;

export interface StepContext {
  adapters: Adapters;
  idempotencyKey: string;
  /** Looked up by the runner: the patient's pharmacy and alternatives, never free text. */
  facts: { pharmacyNpi: string | null; otherPharmacyNpis: string[]; today: string };
}

export interface Skill<I extends z.ZodType = z.ZodType> {
  name: string;
  version: number;
  input: I;
  approval: ApprovalClass;
  adapters: (keyof Adapters)[];
  confirm(i: z.infer<I>, c: StepContext): Promise<Json>;
  do(i: z.infer<I>, c: StepContext, confirmed: Json): Promise<Json>;
  verify(i: z.infer<I>, c: StepContext, done: Json): Promise<Json & { ok: boolean }>;
}

const rxcui = z.string().regex(/^\d{1,10}$/);
const npi = z.string().regex(/^\d{10}$/);
const needPharmacy = (c: StepContext) => {
  if (!c.facts.pharmacyNpi) throw new Error('no pharmacy on file');
  return c.facts.pharmacyNpi;
};
const define = <I extends z.ZodType>(s: Skill<I>) => s;

export const SKILLS = {
  checkRefillStatus: define({
    name: 'checkRefillStatus',
    version: 1,
    input: z.strictObject({ rxcui }),
    approval: 'none',
    adapters: ['pharmacy'],
    confirm: async (_i, c) => ({ pharmacyNpi: needPharmacy(c) }),
    do: async (i, c, confirmed) => {
      const r = await c.adapters.pharmacy.refillStatus({
        pharmacyNpi: confirmed.pharmacyNpi as string,
        rxcui: i.rxcui,
      });
      return { status: r.status, ...(r.untrusted ? { untrusted: r.untrusted } : {}) };
    },
    // Verify by asking again: a status is trusted only if it repeats.
    verify: async (i, c, done) => {
      const again = await c.adapters.pharmacy.refillStatus({ pharmacyNpi: needPharmacy(c), rxcui: i.rxcui });
      return { ok: again.status === done.status, status: again.status };
    },
  }),

  draftRenewalForDoctor: define({
    name: 'draftRenewalForDoctor',
    version: 1,
    input: z.strictObject({ rxcui }),
    approval: 'physician',
    adapters: ['erx'],
    confirm: async (i) => ({ rxcui: i.rxcui }),
    do: async (i, c) =>
      c.adapters.erx.draft({ kind: 'renewal', rxcui: i.rxcui, idempotencyKey: c.idempotencyKey }),
    verify: async (_i, c, done) => {
      const r = await c.adapters.erx.get({ ref: String(done.ref) });
      return { ok: r.status === 'draft', status: r.status };
    },
  }),

  draftFormularyException: define({
    name: 'draftFormularyException',
    version: 1,
    input: z.strictObject({ rxcui }),
    approval: 'physician',
    adapters: ['erx'],
    confirm: async (i) => ({ rxcui: i.rxcui }),
    do: async (i, c) =>
      c.adapters.erx.draft({ kind: 'formulary_exception', rxcui: i.rxcui, idempotencyKey: c.idempotencyKey }),
    verify: async (_i, c, done) => {
      const r = await c.adapters.erx.get({ ref: String(done.ref) });
      return { ok: r.status === 'draft', status: r.status };
    },
  }),

  requestPharmacyTransfer: define({
    name: 'requestPharmacyTransfer',
    version: 1,
    input: z.strictObject({ rxcui, toNpi: npi }),
    approval: 'family', // moves a prescription
    adapters: ['pharmacy'],
    confirm: async (i, c) => {
      const from = needPharmacy(c);
      if (from === i.toNpi) throw new Error('already at that pharmacy');
      return { fromNpi: from };
    },
    do: async (i, c, confirmed) =>
      c.adapters.pharmacy.requestTransfer({
        rxcui: i.rxcui,
        fromNpi: confirmed.fromNpi as string,
        toNpi: i.toNpi,
        idempotencyKey: c.idempotencyKey,
      }),
    verify: async (_i, c, done) => {
      const r = await c.adapters.pharmacy.transferStatus({ ref: String(done.ref) });
      return {
        ok: r.status === 'done',
        status: r.status,
        ...(r.untrusted ? { untrusted: r.untrusted } : {}),
      };
    },
  }),

  findStock: define({
    name: 'findStock',
    version: 1,
    input: z.strictObject({ rxcui }),
    approval: 'none',
    adapters: ['pharmacy'],
    confirm: async (_i, c) => ({
      pharmacies: [c.facts.pharmacyNpi, ...c.facts.otherPharmacyNpis].filter(Boolean),
    }),
    do: async (i, c, confirmed) => ({
      results: await c.adapters.pharmacy.stock({
        rxcui: i.rxcui,
        pharmacyNpis: confirmed.pharmacies as string[],
      }),
    }),
    verify: async (_i, _c, done) => ({
      ok: Array.isArray(done.results),
      found: (done.results as { inStock: boolean }[]).filter((r) => r.inStock).length,
    }),
  }),

  bookPickup: define({
    name: 'bookPickup',
    version: 1,
    input: z.strictObject({ rxcui, pharmacyNpi: npi, date: z.iso.date() }),
    approval: 'none',
    adapters: ['pharmacy'],
    confirm: async (i, c) => {
      if (i.date < c.facts.today) throw new Error('date is in the past');
      return {};
    },
    do: async (i, c) => c.adapters.pharmacy.bookPickup({ ...i, idempotencyKey: c.idempotencyKey }),
    verify: async (_i, _c, done) => ({ ok: typeof done.ref === 'string' }),
  }),

  /** Read-only and neutral (rule 2.11); results are computed by the runner from public files. */
  comparePartDPlans: define({
    name: 'comparePartDPlans',
    version: 1,
    input: z.strictObject({ year: z.number().int().min(2020).max(2100) }),
    approval: 'none',
    adapters: [],
    confirm: async (i) => ({ year: i.year }),
    do: async () => ({}),
    verify: async () => ({ ok: true }),
  }),
} satisfies Record<string, Skill>;

export type SkillName = keyof typeof SKILLS;
export const isSkill = (s: string): s is SkillName => Object.hasOwn(SKILLS, s);

/** Which skill answers which warning. A closed table: the agent never improvises an action. */
export const SKILL_FOR_WARNING: Record<string, SkillName> = {
  run_out: 'draftRenewalForDoctor',
  late_refill: 'checkRefillStatus',
  formulary_removal: 'draftFormularyException',
  tier_change: 'draftFormularyException',
  negotiated_price_change: 'comparePartDPlans',
  premium_jump: 'comparePartDPlans',
  pharmacy_closure: 'requestPharmacyTransfer',
  shortage: 'findStock',
};
