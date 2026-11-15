/**
 * Request/response schemas shared by the API (validation + OpenAPI) and the web clients.
 * Every boundary goes through one of these (BUILD_PROMPT §3, SECURITY S11).
 */
import { z } from 'zod';
import { ROLES } from '@tomoni/core';

export const Role = z.enum(ROLES);
export const Surface = z.enum(['family', 'desk', 'ops', 'sponsor', 'admin']);

export const ErrorBody = z.object({
  error: z.string(),
  message: z.string(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

// ─── auth ────────────────────────────────────────────────────────────────────
export const LoginBody = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
});

/** What the client must do next after a successful password step. */
export const MfaStep = z.enum(['none', 'verify', 'enroll']);

export const LoginResponse = z.object({
  next: MfaStep,
  surfaces: z.array(Surface),
});
export type LoginResponse = z.infer<typeof LoginResponse>;

export const MfaCodeBody = z.strictObject({ code: z.string().regex(/^\d{6}$/) });

export const MfaEnrollResponse = z.object({
  otpauthUri: z.string(),
  secret: z.string(),
});

export const Me = z.object({
  user: z.object({ id: z.uuid(), email: z.string(), displayName: z.string() }),
  roles: z.array(Role),
  surfaces: z.array(Surface),
  mfa: z.object({ required: z.boolean(), enabled: z.boolean(), verified: z.boolean() }),
});
export type Me = z.infer<typeof Me>;

// ─── system ──────────────────────────────────────────────────────────────────
export const SandboxStatus = z.object({
  sandbox: z.boolean(),
  mockAdapters: z.array(z.string()),
  realDataEnabled: z.boolean(),
});
export type SandboxStatus = z.infer<typeof SandboxStatus>;

export const Health = z.object({ ok: z.boolean(), db: z.boolean(), redis: z.boolean() });

// ─── background jobs (API → worker via BullMQ) ──────────────────────────────
export const QUEUE = 'tomoni';
export const JobPayloads = {
  'audit.seal': z.strictObject({}),
  'engine.run': z.strictObject({ patientIds: z.array(z.uuid()).max(10_000).optional() }),
  'bluebutton.sync': z.strictObject({ patientId: z.uuid() }),
  'call.schedule': z.strictObject({}),
  'call.place': z.strictObject({ callId: z.uuid() }),
  'notify.family': z.strictObject({ flagId: z.uuid() }),
} as const;
export type JobName = keyof typeof JobPayloads;
export type JobData<N extends JobName> = z.infer<(typeof JobPayloads)[N]>;
/** Retries with backoff for every job (BUILD_PROMPT §5.3). */
export const JOB_DEFAULTS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
} as const;

// ─── medicines (Phase 2) ─────────────────────────────────────────────────────
export const AccessStatus = z.enum(['green', 'amber', 'red']);
export type AccessStatus = z.infer<typeof AccessStatus>;
export const WarningType = z.enum([
  'run_out',
  'late_refill',
  'premium_jump',
  'formulary_removal',
  'tier_change',
  'negotiated_price_change',
  'pharmacy_closure',
  'shortage',
  'gene_drug_mismatch',
]);
export type WarningType = z.infer<typeof WarningType>;

/** The numbers a warning sentence needs. Ids, dates, tiers and prices only. */
export const WarningFacts = z.object({
  runOutDate: z.string().optional(),
  daysWithout: z.number().optional(),
  refillsRemaining: z.number().nullable().optional(),
  tierBefore: z.number().nullable().optional(),
  tierAfter: z.number().nullable().optional(),
  premiumBeforeCents: z.number().optional(),
  premiumAfterCents: z.number().optional(),
  cost30BeforeCents: z.number().optional(),
  cost30AfterCents: z.number().optional(),
  plan: z.string().optional(),
  pharmacy: z.string().optional(),
  closesOn: z.string().optional(),
  drugs: z.array(z.string()).optional(),
});
export type WarningFacts = z.infer<typeof WarningFacts>;

export const WarningItem = z.object({
  id: z.uuid(),
  patientId: z.uuid(),
  type: WarningType,
  access: AccessStatus,
  daysUntilProblem: z.number().int(),
  problemDate: z.string(),
  medicationId: z.uuid().nullable(),
  drug: z.string().nullable(),
  source: z.object({
    kind: z.enum(['fill', 'data_file', 'call', 'pgx']),
    date: z.string(),
    label: z.string(),
  }),
  facts: WarningFacts,
});
export type WarningItem = z.infer<typeof WarningItem>;

export const FamilyCard = z.object({
  asOf: z.string(),
  patients: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      access: AccessStatus,
      medicare: z
        .object({ mode: z.enum(['sandbox', 'mock', 'production']), lastSyncedAt: z.string().nullable() })
        .nullable(),
      medicines: z.array(
        z.object({ id: z.uuid(), name: z.string(), access: AccessStatus, runOutDate: z.string().nullable() }),
      ),
      warnings: z.array(WarningItem),
    }),
  ),
});
export type FamilyCard = z.infer<typeof FamilyCard>;

export const WarningEvidence = z.object({
  warning: WarningItem.extend({
    status: z.enum(['open', 'resolved']),
    createdAt: z.string(),
    patientName: z.string(),
  }),
  fills: z.array(
    z.object({
      id: z.uuid(),
      fillDate: z.string(),
      daysSupply: z.number(),
      quantity: z.string(),
      ndc: z.string(),
      drug: z.string(),
      pharmacy: z.string().nullable(),
      source: z.enum(['bluebutton', 'mock', 'manual']),
      sourceRef: z.string(),
    }),
  ),
  files: z.array(
    z.object({
      id: z.uuid(),
      role: z.enum(['before', 'after']),
      kind: z.string(),
      label: z.string(),
      sourceUrl: z.string(),
      effectiveDate: z.string(),
      sha256: z.string(),
      loadedAt: z.string(),
      rowCount: z.number(),
      droppedCount: z.number(),
    }),
  ),
});
export type WarningEvidence = z.infer<typeof WarningEvidence>;

export const BlueButtonConnect = z.object({
  authorizeUrl: z.string(),
  mode: z.enum(['sandbox', 'mock', 'production']),
});

export const PbmCsvBody = z.strictObject({
  csv: z
    .string()
    .min(1)
    .max(2 * 1024 * 1024),
});
export const PbmPreview = z.object({
  headers: z.array(z.string()),
  sample: z.array(z.array(z.string())),
  rowCount: z.number(),
});
export const PbmUploadBody = z.strictObject({
  csv: z
    .string()
    .min(1)
    .max(2 * 1024 * 1024),
  label: z.string().trim().min(1).max(120),
  mapping: z.strictObject({
    formularyId: z.string().min(1).max(100),
    drug: z.strictObject({ column: z.string().min(1).max(100), kind: z.enum(['rxcui', 'ndc']) }),
    change: z.string().min(1).max(100),
    newTier: z.string().min(1).max(100).nullable(),
    effectiveDate: z.string().min(1).max(100),
  }),
});
export const PbmUploadResult = z.object({
  versionId: z.uuid().nullable(),
  saved: z.number(),
  duplicate: z.boolean(),
  unknownDrugs: z.number(),
  dropped: z.array(z.object({ line: z.number(), reason: z.string() })),
  droppedCount: z.number(),
  total: z.number(),
});
export const DataFiles = z.array(
  z.object({
    id: z.uuid(),
    kind: z.string(),
    label: z.string(),
    sourceUrl: z.string(),
    effectiveDate: z.string(),
    rowCount: z.number(),
    droppedCount: z.number(),
    loadedAt: z.string(),
  }),
);
export type DataFiles = z.infer<typeof DataFiles>;

// ─── live events (outbox → Redis → SSE) ─────────────────────────────────────
export const EVENTS_CHANNEL = 'tomoni:events';
/** What reaches a browser: ids and types only, never PHI. Clients refetch what changed. */
export const AppEvent = z.object({
  id: z.number(),
  topic: z.string(),
  aggregateType: z.string(),
  aggregateId: z.uuid(),
  practiceId: z.uuid().nullable(),
  householdId: z.uuid().nullable(),
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type AppEvent = z.infer<typeof AppEvent>;

// ─── calls and nurse flags (Phase 3) ─────────────────────────────────────────
export const FlagClass = z.enum(['emergency', 'symptom', 'medication_change', 'self_harm']);
export const SimStartBody = z.strictObject({ patientId: z.uuid() });
export const SimTurnBody = z.strictObject({ text: z.string().trim().min(1).max(1000) });
export const SimTurnResult = z.object({
  callId: z.uuid(),
  say: z.array(z.string()),
  ended: z.boolean(),
  outcome: z.enum(['completed', 'escalated']).nullable(),
  flags: z.array(z.object({ id: z.uuid(), class: FlagClass, urgency: z.number() })),
});
export type SimTurnResult = z.infer<typeof SimTurnResult>;
export const DeskPatients = z.array(z.object({ id: z.uuid(), name: z.string(), locale: z.string() }));
export type DeskPatients = z.infer<typeof DeskPatients>;
export const NurseFlagItem = z.object({
  id: z.uuid(),
  patientId: z.uuid(),
  patientName: z.string(),
  class: FlagClass,
  urgency: z.number(),
  status: z.enum(['open', 'acknowledged', 'resolved']),
  excerpt: z.string(),
  matchedRule: z.string(),
  channel: z.string(),
  callId: z.uuid().nullable(),
  createdAt: z.string(),
  acknowledgedAt: z.string().nullable(),
});
export const NurseFlags = z.array(NurseFlagItem);
export type NurseFlagItem = z.infer<typeof NurseFlagItem>;
export const ResolveFlagBody = z.strictObject({ note: z.string().trim().min(1).max(1000) });
