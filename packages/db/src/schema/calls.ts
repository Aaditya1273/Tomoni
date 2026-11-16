import { boolean, date, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea, encrypted } from '../fields';
import { care } from './care';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export type CallChannel = 'voice' | 'sms' | 'whatsapp' | 'simulator';
export type CallOutcome = 'completed' | 'no_answer' | 'voicemail' | 'failed' | 'escalated' | 'declined';
export type FlagClass = 'emergency' | 'symptom' | 'medication_change' | 'self_harm';
export type ActionState =
  | 'proposed'
  | 'awaiting_approval'
  | 'approved'
  | 'running'
  | 'verifying'
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'handoff'
  | 'cancelled';
export type ApprovalClass = 'none' | 'family' | 'physician';

export const call = care.table('call', {
  id: uuid().primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  direction: text().$type<'outbound' | 'inbound'>().notNull().default('outbound'),
  channel: text().$type<CallChannel>().notNull(),
  scheduledFor: ts('scheduled_for'),
  startedAt: ts('started_at'),
  endedAt: ts('ended_at'),
  locale: text().notNull(),
  scriptVersion: text('script_version').notNull(),
  promptVersion: text('prompt_version'),
  step: text().notNull().default('scheduled'),
  slots: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  outcome: text().$type<CallOutcome>(),
  disclosurePlayed: boolean('disclosure_played').notNull().default(false),
  recordingConsent: boolean('recording_consent').notNull().default(false),
  transcript: encrypted('care.call.transcript'),
  summary: encrypted('care.call.summary'),
  careSeconds: integer('care_seconds').notNull().default(0),
  researchSeconds: integer('research_seconds').notNull().default(0),
  telephonyRef: text('telephony_ref'),
  idempotencyKey: text('idempotency_key'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const nurseFlag = care.table('nurse_flag', {
  id: uuid().primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  callId: uuid('call_id'),
  channel: text().$type<CallChannel | 'family_app'>().notNull(),
  class: text().$type<FlagClass>().notNull(),
  matchedRule: text('matched_rule').notNull(),
  excerpt: encrypted('care.nurse_flag.excerpt').notNull(),
  urgency: integer().notNull(),
  status: text().$type<'open' | 'acknowledged' | 'resolved'>().notNull().default('open'),
  assignedTo: uuid('assigned_to'),
  acknowledgedAt: ts('acknowledged_at'),
  resolvedAt: ts('resolved_at'),
  resolutionNote: encrypted('care.nurse_flag.resolution_note'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const action = care.table('action', {
  id: uuid().primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  warningId: uuid('warning_id'),
  skill: text().notNull(),
  skillVersion: integer('skill_version').notNull(),
  inputs: jsonb().$type<Record<string, unknown>>().notNull(),
  approvalClass: text('approval_class').$type<ApprovalClass>().notNull(),
  state: text().$type<ActionState>().notNull().default('proposed'),
  confirmResult: jsonb('confirm_result').$type<Record<string, unknown>>(),
  doResult: jsonb('do_result').$type<Record<string, unknown>>(),
  verifyResult: jsonb('verify_result').$type<Record<string, unknown>>(),
  attempts: integer().notNull().default(0),
  nextAttemptAt: ts('next_attempt_at'),
  handoffReason: text('handoff_reason'),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const approval = care.table('approval', {
  id: uuid().primaryKey().defaultRandom(),
  actionId: uuid('action_id').notNull(),
  approverUserId: uuid('approver_user_id').notNull(),
  approverRole: text('approver_role').notNull(),
  decision: text().$type<'approve' | 'reject'>().notNull(),
  reason: text(),
  decidedAt: ts('decided_at').notNull().defaultNow(),
});

export type CarePlanBody = {
  problems: { code: string; name: string }[];
  goals: string[];
  medications: string[];
  interventions: string[];
  contacts: { name: string; role: string }[];
};

export const carePlan = care.table('care_plan', {
  id: uuid().primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  version: integer().notNull(),
  status: text().$type<'draft' | 'signed' | 'superseded'>().notNull().default('draft'),
  body: jsonb().$type<CarePlanBody>().notNull(),
  revision: integer().notNull().default(0),
  draftedBy: text('drafted_by').notNull(),
  signedBy: uuid('signed_by'),
  signedAt: ts('signed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export type ApcmService = { kind: string; at: string; ref: string };
export const apcmMonthRecord = care.table('apcm_month_record', {
  id: uuid().primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  practiceId: uuid('practice_id').notNull(),
  month: date().notNull(),
  hcpcs: text().$type<'G0556' | 'G0557' | 'G0558'>(),
  chronicConditions: text('chronic_conditions').array().notNull().default([]),
  consentId: uuid('consent_id'),
  carePlanId: uuid('care_plan_id'),
  services: jsonb().$type<ApcmService[]>().notNull().default([]),
  status: text().$type<'draft' | 'ready' | 'billed' | 'excluded'>().notNull().default('draft'),
  exclusionReason: text('exclusion_reason'),
  billedAt: ts('billed_at'),
  billedBy: uuid('billed_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const invite = care.table('invite', {
  id: uuid().primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull(),
  kind: text().$type<'sibling' | 'doctor'>().notNull(),
  target: encrypted('care.invite.target').notNull(),
  tokenHash: bytea('token_hash'),
  status: text().$type<'pending' | 'accepted' | 'revoked'>().notNull().default('pending'),
  createdBy: uuid('created_by').notNull(),
  acceptedBy: uuid('accepted_by'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});
