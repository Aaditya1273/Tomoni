import { bigserial, boolean, date, integer, jsonb, pgSchema, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea, encrypted } from '../fields';

export const care = pgSchema('care');

const ts = (name: string) => timestamp(name, { withTimezone: true });
const stamps = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};

export const practice = care.table('practice', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  npi: text(),
  tz: text().notNull(),
  phone: text(),
  address: text(),
  apcmEnrolledAt: date('apcm_enrolled_at'),
  offshoreOpsAccess: boolean('offshore_ops_access').notNull().default(false),
  ...stamps,
});

export const clinician = care.table('clinician', {
  id: uuid().primaryKey().defaultRandom(),
  practiceId: uuid('practice_id').notNull(),
  userId: uuid('user_id'),
  npi: text(),
  kind: text().$type<'physician' | 'nurse' | 'front_desk'>().notNull(),
  displayName: text('display_name').notNull(),
  ...stamps,
});

export const household = care.table('household', {
  id: uuid().primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  primaryLocale: text('primary_locale').notNull(),
  ...stamps,
});

export const patient = care.table('patient', {
  id: uuid().primaryKey().defaultRandom(),
  practiceId: uuid('practice_id').notNull(),
  householdId: uuid('household_id').notNull(),
  mbi: encrypted('care.patient.mbi'),
  mbiHash: bytea('mbi_hash'),
  name: encrypted('care.patient.name').notNull(),
  preferredName: encrypted('care.patient.preferred_name'),
  dob: encrypted('care.patient.dob').notNull(),
  birthYear: integer('birth_year').notNull(),
  phone: encrypted('care.patient.phone'),
  phoneHash: bytea('phone_hash'),
  address: encrypted('care.patient.address'),
  state: text().notNull(),
  locale: text().notNull(),
  tz: text().notNull(),
  callWindowStart: time('call_window_start').notNull().default('10:00'),
  callWindowEnd: time('call_window_end').notNull().default('12:00'),
  medicareType: text('medicare_type').$type<'original' | 'advantage'>().notNull(),
  status: text().$type<'active' | 'paused' | 'deceased' | 'left'>().notNull().default('active'),
  ...stamps,
});

export const familyMember = care.table('family_member', {
  id: uuid().primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull(),
  userId: uuid('user_id'),
  displayName: text('display_name').notNull(),
  relationship: text().notNull(),
  phone: encrypted('care.family_member.phone'),
  phoneHash: bytea('phone_hash'),
  notifyOnEmergency: boolean('notify_on_emergency').notNull().default(true),
  ...stamps,
});

export const representative = care.table('representative', {
  id: uuid().primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  familyMemberId: uuid('family_member_id'),
  externalName: encrypted('care.representative.external_name'),
  legalBasis: text('legal_basis').$type<'healthcare_poa' | 'guardian' | 'state_surrogate'>().notNull(),
  documentRef: text('document_ref'),
  verifiedBy: uuid('verified_by'),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  ...stamps,
});

export const careConsent = care.table('care_consent', {
  id: uuid().primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  practiceId: uuid('practice_id').notNull(),
  program: text().$type<'apcm'>().notNull().default('apcm'),
  givenByKind: text('given_by_kind').$type<'patient' | 'representative'>().notNull(),
  givenById: uuid('given_by_id'),
  method: text().$type<'verbal_recorded' | 'written' | 'e_sign'>().notNull(),
  copayDisclosed: boolean('copay_disclosed').notNull(),
  givenAt: ts('given_at').notNull(),
  withdrawnAt: ts('withdrawn_at'),
  withdrawalRecordedBy: uuid('withdrawal_recorded_by'),
  evidenceRef: text('evidence_ref'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const contactConsent = care.table('contact_consent', {
  id: uuid().primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  channel: text().$type<'voice' | 'sms' | 'whatsapp'>().notNull(),
  phoneHash: bytea('phone_hash').notNull(),
  recordingAllowed: boolean('recording_allowed').notNull().default(false),
  quietStart: time('quiet_start').notNull().default('20:00'),
  quietEnd: time('quiet_end').notNull().default('09:00'),
  givenByKind: text('given_by_kind').$type<'patient' | 'representative'>().notNull(),
  givenById: uuid('given_by_id'),
  givenAt: ts('given_at').notNull(),
  withdrawnAt: ts('withdrawn_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const outbox = care.table('outbox', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  topic: text().notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  practiceId: uuid('practice_id'),
  householdId: uuid('household_id'),
  payload: jsonb().$type<Record<string, string | number | boolean | null>>().notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
  publishedAt: ts('published_at'),
});
