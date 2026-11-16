/**
 * Request/response schemas shared by the API (validation + OpenAPI) and the web clients.
 * Every boundary goes through one of these (BUILD_PROMPT §3, SECURITY S11).
 */
import { z } from 'zod';
import { ROLES } from '@tomoni/core';

export const Role = z.enum(ROLES);
export const Surface = z.enum(['family', 'desk', 'ops', 'sponsor', 'research', 'admin']);

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
  'action.run': z.strictObject({ actionId: z.uuid() }),
  'trials.match': z.strictObject({}),
  'research.nightly': z.strictObject({}),
  'research.audio': z.strictObject({
    sampleId: z.uuid(),
    recordingRef: z.string().regex(/^RE[0-9a-f]{32}$/),
  }),
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
      region: z.enum(['US', 'IN']),
      householdId: z.uuid(),
      access: AccessStatus,
      medicare: z
        .object({ mode: z.enum(['sandbox', 'mock', 'production']), lastSyncedAt: z.string().nullable() })
        .nullable(),
      medicines: z.array(
        z.object({ id: z.uuid(), name: z.string(), access: AccessStatus, runOutDate: z.string().nullable() }),
      ),
      warnings: z.array(WarningItem),
      actions: z.array(z.lazy(() => ActionItem)),
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
      ndc: z.string().nullable(),
      /** Family-entered fills: the prescription photo behind them. */
      hasPhoto: z.boolean(),
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

// ─── agent actions (Phase 3) ─────────────────────────────────────────────────
export const ActionState = z.enum([
  'proposed',
  'awaiting_approval',
  'approved',
  'running',
  'verifying',
  'succeeded',
  'rejected',
  'failed',
  'handoff',
  'cancelled',
]);
export const ActionItem = z.object({
  id: z.uuid(),
  patientId: z.uuid(),
  warningId: z.uuid().nullable(),
  skill: z.string(),
  state: ActionState,
  approvalClass: z.enum(['none', 'family', 'physician']),
  /** Plain facts for the sentence: drug, pharmacy names, refill status, plan ranks. Never adapter free text. */
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  updatedAt: z.string(),
});
export type ActionItem = z.infer<typeof ActionItem>;
export const ActionList = z.array(ActionItem.extend({ patientName: z.string() }));
export type ActionList = z.infer<typeof ActionList>;
export const DecisionBody = z.strictObject({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(500).optional(),
});

// ─── desk: patient, care plans, APCM, practice report (Phase 4) ─────────────
export const Month = z.string().regex(/^20\d\d-(0[1-9]|1[0-2])$/);
export const CarePlanItem = z.object({
  id: z.uuid(),
  version: z.number(),
  status: z.enum(['draft', 'signed', 'superseded']),
  body: z.object({
    problems: z.array(z.object({ code: z.string(), name: z.string() })),
    goals: z.array(z.string()),
    medications: z.array(z.string()),
    interventions: z.array(z.string()),
    contacts: z.array(z.object({ name: z.string(), role: z.string() })),
  }),
  draftedBy: z.string(),
  signedAt: z.string().nullable(),
  /** Bumped by each edit of a draft; signing names the revision the physician saw. */
  revision: z.number(),
});
export type CarePlanItem = z.infer<typeof CarePlanItem>;
export const TimelineEvent = z.object({
  at: z.string(),
  kind: z.enum(['call', 'fill', 'warning', 'action', 'flag', 'care_plan']),
  title: z.string(),
  detail: z.string().nullable(),
  ref: z.string(),
});
export const DeskPatient = z.object({
  id: z.uuid(),
  name: z.string(),
  locale: z.string(),
  birthYear: z.number(),
  apcmEnrolled: z.boolean(),
  carePlans: z.array(CarePlanItem),
  timeline: z.array(TimelineEvent),
});
export type DeskPatient = z.infer<typeof DeskPatient>;
export const ApcmRecordItem = z.object({
  id: z.uuid(),
  patientId: z.uuid(),
  patientName: z.string(),
  month: z.string(),
  hcpcs: z.enum(['G0556', 'G0557', 'G0558']).nullable(),
  chronicConditions: z.array(z.string()),
  status: z.enum(['draft', 'ready', 'billed', 'excluded']),
  exclusionReason: z.string().nullable(),
  services: z.number(),
  rateCents: z.number().nullable(),
});
export const ApcmList = z.array(ApcmRecordItem);
export type ApcmList = z.infer<typeof ApcmList>;
export const PracticeReport = z.object({
  month: z.string(),
  enrolled: z.number(),
  ready: z.number(),
  billed: z.number(),
  excluded: z.number(),
  apcmRevenueCents: z.number(),
  callsCompleted: z.number(),
  flagsRaised: z.number(),
  flagsHandled: z.number(),
  tasksDoneByTomoni: z.number(),
  problemsCaughtEarly: z.number(),
});
export type PracticeReport = z.infer<typeof PracticeReport>;

/** One row of the doctor desk queue (§5.6): everything that needs a person, most urgent first. */
export const QueueItem = z.object({
  kind: z.enum(['flag', 'approval', 'care_plan', 'gene_drug']),
  id: z.uuid(),
  patientId: z.uuid(),
  patientName: z.string(),
  urgency: z.number(), // 1 = now … 4 = routine
  createdAt: z.string(),
  // flag
  flagClass: FlagClass.optional(),
  excerpt: z.string().optional(),
  flagStatus: z.enum(['open', 'acknowledged', 'resolved']).optional(),
  channel: z.string().optional(),
  // approval
  skill: z.string().optional(),
  drug: z.string().nullable().optional(),
  warningId: z.uuid().nullable().optional(),
  // care plan
  version: z.number().optional(),
  revision: z.number().optional(),
  // gene-drug warning (doctor only)
  gene: z.string().optional(),
  phenotype: z.string().optional(),
  guideline: z.string().optional(),
});
export type QueueItem = z.infer<typeof QueueItem>;
export const DeskQueue = z.array(QueueItem);

// ─── family: activity, streaks, invites (Phase 4) ───────────────────────────
export const ActivityEvent = z.object({
  at: z.string(),
  patientId: z.uuid(),
  patientName: z.string(),
  kind: z.enum(['call', 'action', 'warning', 'flag']),
  /** A key the web app words; facts are plain values, never free text from calls or adapters. */
  what: z.string(),
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
});
export const Activity = z.object({
  events: z.array(ActivityEvent),
  streaks: z.array(
    z.object({
      patientId: z.uuid(),
      patientName: z.string(),
      callStreak: z.number(),
      shieldUsed: z.boolean(),
    }),
  ),
  week: z.object({
    calls: z.number(),
    problemsCaught: z.number(),
    tasksDone: z.number(),
    minutesSaved: z.number(),
  }),
});
export type Activity = z.infer<typeof Activity>;
export const InviteBody = z.strictObject({
  kind: z.enum(['sibling', 'doctor']),
  email: z.email().max(254),
});
export const InviteResult = z.object({ id: z.uuid(), acceptUrl: z.string().nullable() });
export const AcceptInviteBody = z.strictObject({
  token: z.string().min(20).max(100),
  displayName: z.string().trim().min(1).max(100),
  password: z.string().min(12).max(256),
});

// ─── India bridge: family-entered medicines (Phase 4b) ──────────────────────
export const AddMedicineBody = z.strictObject({
  name: z.string().trim().min(2).max(120),
  dosesPerDay: z.number().int().min(1).max(12),
  quantity: z.number().int().min(1).max(1000),
  filledOn: z.iso.date(),
  refillsLeft: z.number().int().min(0).max(20).nullable(),
  /** Base64 photo of the prescription or pharmacy bill, at most ~5 MB. */
  photo: z.string().max(7_000_000).nullable(),
});

// ─── research and Trial Bridge (Phase 5) ────────────────────────────────────
export const ResearchScopes = z.strictObject({
  speechTask: z.boolean(),
  trialMatching: z.boolean(),
  pgxResearch: z.boolean(),
});
export const ResearchOverview = z.object({
  protocol: z
    .object({
      id: z.uuid(),
      title: z.string(),
      code: z.string(),
      version: z.number(),
      irbName: z.string(),
      irbApprovalRef: z.string().nullable(),
      expiresAt: z.string().nullable(),
      summary: z.string(),
    })
    .nullable(),
  people: z.array(
    z.object({
      patientId: z.uuid(),
      name: z.string(),
      /** How the signed-in user may consent for this person, if at all (rule 2.6). */
      canConsentAs: z.enum(['patient', 'representative']).nullable(),
      representativeId: z.uuid().nullable(),
      consent: z
        .object({
          id: z.uuid(),
          scopes: ResearchScopes,
          recordingPermission: z.boolean(),
          givenAt: z.string(),
          givenBy: z.string(),
        })
        .nullable(),
    }),
  ),
});
export type ResearchOverview = z.infer<typeof ResearchOverview>;
export const ResearchConsentBody = z.strictObject({
  patientId: z.uuid(),
  protocolId: z.uuid(),
  scopes: ResearchScopes,
  recordingPermission: z.boolean(),
  /** Typed full name: the e-signature. Kept in the audit trail, not on the consent row. */
  signature: z.string().trim().min(2).max(120),
});
export const TrialIntro = z.object({
  matchId: z.uuid(),
  patientId: z.uuid(),
  patientName: z.string(),
  trialTitle: z.string(),
  therapeuticArea: z.string(),
  status: z.string(),
});
export const TrialIntros = z.array(TrialIntro);
export type TrialIntros = z.infer<typeof TrialIntros>;
export const MatchStage = z.enum([
  'prescreened',
  'introduced',
  'consent_prep',
  'referred',
  'randomized',
  'declined',
  'ineligible',
]);
export const ResearchMatches = z.array(
  z.object({
    matchId: z.uuid(),
    patientName: z.string(),
    trialTitle: z.string(),
    status: z.string(),
    updatedAt: z.string(),
  }),
);
export type ResearchMatches = z.infer<typeof ResearchMatches>;
// Sponsor portal: aggregates only.
export const SponsorTrials = z.array(
  z.object({
    id: z.uuid(),
    title: z.string(),
    nctId: z.string().nullable(),
    therapeuticArea: z.string(),
    status: z.string(),
  }),
);
export type SponsorTrials = z.infer<typeof SponsorTrials>;
export const FeasibilityBody = z.strictObject({
  conditions: z
    .array(
      z.enum([
        'diabetes',
        'hypertension',
        'hyperlipidemia',
        'coronary_artery_disease',
        'heart_failure',
        'atrial_fibrillation',
        'copd',
        'asthma',
        'ckd',
        'hypothyroidism',
        'dementia',
        'depression',
        'osteoarthritis',
        'bph',
      ]),
    )
    .max(5)
    .optional(),
  languages: z
    .array(z.enum(['en', 'hi', 'gu', 'ta', 'pa', 'bn']))
    .max(6)
    .optional(),
  inpatient_within_days: z
    .union([z.literal(0), z.literal(90), z.literal(180), z.literal(365), z.literal(730)])
    .optional(),
});
export const Feasibility = z.object({
  total: z.number().nullable(),
  byAgeBand: z.array(z.object({ band: z.string(), n: z.number().nullable() })),
  suppressedUnder: z.number(),
  roundedTo: z.number(),
});
export type Feasibility = z.infer<typeof Feasibility>;
export const Funnel = z.record(z.string(), z.number().nullable());
export type Funnel = z.infer<typeof Funnel>;
export const SponsorUsage = z.array(
  z.object({ month: z.string(), unit: z.string(), units: z.number(), amountCents: z.number() }),
);
export type SponsorUsage = z.infer<typeof SponsorUsage>;

// ─── Gene-to-Pill (Phase 6) ──────────────────────────────────────────────────
export const PgxResultBody = z.strictObject({
  gene: z.enum(['CYP2C19', 'SLCO1B1', 'CYP2C9', 'VKORC1', 'CYP2D6']),
  diplotype: z.string().regex(/^[*A-Za-z0-9./ -]{1,30}$/),
  phenotype: z.enum([
    'Ultrarapid Metabolizer',
    'Rapid Metabolizer',
    'Normal Metabolizer',
    'Intermediate Metabolizer',
    'Poor Metabolizer',
    'Normal Function',
    'Decreased Function',
    'Poor Function',
  ]),
  lab: z.string().trim().min(2).max(120),
  reportedAt: z.iso.date(),
});

// ─── family billing (Phase 4b, D-030) ───────────────────────────────────────
export const BillingStatus = z.object({
  householdId: z.uuid(),
  region: z.enum(['US', 'IN']),
  status: z.enum(['none', 'pending', 'active', 'past_due', 'canceled']),
  periodEnd: z.string().nullable(),
  /** The plan ends then (a cancel at period end); calls stop after it. */
  cancelAt: z.string().nullable(),
  price: z.object({ cents: z.int(), currency: z.literal('USD') }),
});
export type BillingStatus = z.infer<typeof BillingStatus>;
