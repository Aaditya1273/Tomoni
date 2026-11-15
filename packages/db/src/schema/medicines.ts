import {
  boolean,
  customType,
  date,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, encrypted } from '../fields';
import { care } from './care';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const textArray = customType<{ data: string[]; driverData: string[] }>({ dataType: () => 'text[]' });

export type DataFileKind = 'cms_partd' | 'pbm_changes' | 'shortage' | 'pharmacy_closure';
export type FillSource = 'bluebutton' | 'mock' | 'manual';
export type WarningType =
  | 'run_out'
  | 'late_refill'
  | 'premium_jump'
  | 'formulary_removal'
  | 'tier_change'
  | 'negotiated_price_change'
  | 'pharmacy_closure'
  | 'shortage'
  | 'gene_drug_mismatch';
export type AccessStatus = 'green' | 'amber' | 'red';

export const dataFileVersion = care.table('data_file_version', {
  id: uuid().primaryKey().defaultRandom(),
  kind: text().$type<DataFileKind>().notNull(),
  label: text().notNull(),
  sourceUrl: text('source_url').notNull(),
  sha256: bytea('sha256').notNull(),
  effectiveDate: date('effective_date').notNull(),
  rowCount: integer('row_count').notNull(),
  droppedCount: integer('dropped_count').notNull().default(0),
  loadedBy: text('loaded_by').notNull(),
  loadedAt: ts('loaded_at').notNull().defaultNow(),
});

export const drug = care.table('drug', {
  ndc: text().primaryKey(),
  rxcui: text().notNull(),
  name: text().notNull(),
});

export const pharmacy = care.table('pharmacy', {
  id: uuid().primaryKey().defaultRandom(),
  npi: text().notNull(),
  name: text().notNull(),
  address: text(),
  phone: text(),
});

export const plan = care.table('plan', {
  id: uuid().primaryKey().defaultRandom(),
  versionId: uuid('version_id').notNull(),
  year: integer().notNull(),
  contractId: text('contract_id').notNull(),
  planId: text('plan_id').notNull(),
  segmentId: text('segment_id').notNull(),
  name: text().notNull(),
  type: text().$type<'pdp' | 'mapd'>().notNull(),
  premiumCents: integer('premium_cents').notNull(),
  deductibleCents: integer('deductible_cents').notNull(),
  formularyId: text('formulary_id').notNull(),
});

export const formularyEntry = care.table(
  'formulary_entry',
  {
    versionId: uuid('version_id').notNull(),
    formularyId: text('formulary_id').notNull(),
    rxcui: text().notNull(),
    tier: integer().notNull(),
    priorAuth: boolean('prior_auth').notNull(),
    stepTherapy: boolean('step_therapy').notNull(),
    quantityLimit: boolean('quantity_limit').notNull(),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.formularyId, t.rxcui] })],
);

export const drugPrice = care.table(
  'drug_price',
  {
    versionId: uuid('version_id').notNull(),
    contractId: text('contract_id').notNull(),
    planId: text('plan_id').notNull(),
    segmentId: text('segment_id').notNull(),
    rxcui: text().notNull(),
    daysSupply: integer('days_supply').notNull(),
    unitCost: numeric('unit_cost').notNull(),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.contractId, t.planId, t.segmentId, t.rxcui, t.daysSupply] })],
);

export const formularyChange = care.table(
  'formulary_change',
  {
    versionId: uuid('version_id').notNull(),
    formularyId: text('formulary_id').notNull(),
    rxcui: text().notNull(),
    change: text().$type<'removal' | 'tier_change'>().notNull(),
    newTier: integer('new_tier'),
    effectiveDate: date('effective_date').notNull(),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.formularyId, t.rxcui] })],
);

export const drugShortage = care.table(
  'drug_shortage',
  {
    versionId: uuid('version_id').notNull(),
    rxcui: text().notNull(),
    reportedOn: date('reported_on').notNull(),
    resolvedOn: date('resolved_on'),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.rxcui] })],
);

export const pharmacyClosure = care.table(
  'pharmacy_closure',
  {
    versionId: uuid('version_id').notNull(),
    pharmacyId: uuid('pharmacy_id').notNull(),
    closesOn: date('closes_on').notNull(),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.pharmacyId] })],
);

export const patientPlan = care.table(
  'patient_plan',
  {
    patientId: uuid('patient_id').notNull(),
    year: integer().notNull(),
    contractId: text('contract_id').notNull(),
    planId: text('plan_id').notNull(),
    segmentId: text('segment_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.patientId, t.year] })],
);

export const medication = care.table('medication', {
  id: uuid().primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  rxcui: text(),
  displayName: text('display_name').notNull(),
  sigText: encrypted('care.medication.sig_text'),
  prescriberClinicianId: uuid('prescriber_clinician_id'),
  active: boolean().notNull().default(true),
  source: text().$type<'claims' | 'desk' | 'family' | 'call'>().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const fill = care.table('fill', {
  id: uuid().primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  medicationId: uuid('medication_id'),
  ndc: text().notNull(),
  rxcui: text(),
  fillDate: date('fill_date').notNull(),
  daysSupply: integer('days_supply').notNull(),
  quantity: numeric().notNull(),
  fillNumber: integer('fill_number'),
  refillsRemaining: integer('refills_remaining'),
  pharmacyId: uuid('pharmacy_id'),
  patientPaidCents: integer('patient_paid_cents'),
  source: text().$type<FillSource>().notNull(),
  sourceRef: text('source_ref').notNull(),
  ingestedAt: ts('ingested_at').notNull().defaultNow(),
});

export const claim = care.table('claim', {
  id: uuid().primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  kind: text().$type<'inpatient' | 'outpatient' | 'carrier' | 'snf' | 'hha' | 'hospice'>().notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  dxCodes: textArray('dx_codes').notNull().default([]),
  source: text().$type<FillSource>().notNull(),
  sourceRef: text('source_ref').notNull(),
  ingestedAt: ts('ingested_at').notNull().defaultNow(),
});

export const bluebuttonLink = care.table('bluebutton_link', {
  patientId: uuid('patient_id').primaryKey(),
  mode: text().$type<'sandbox' | 'mock' | 'production'>().notNull(),
  fhirPatientId: encrypted('care.bluebutton_link.fhir_patient_id').notNull(),
  accessToken: encrypted('care.bluebutton_link.access_token'),
  refreshToken: encrypted('care.bluebutton_link.refresh_token'),
  expiresAt: ts('expires_at'),
  scope: text().notNull().default(''),
  connectedBy: uuid('connected_by'),
  connectedAt: ts('connected_at').notNull().defaultNow(),
  lastSyncedAt: ts('last_synced_at'),
  revokedAt: ts('revoked_at'),
});

export const warning = care.table('warning', {
  id: uuid().primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  medicationId: uuid('medication_id'),
  rxcui: text(),
  type: text().$type<WarningType>().notNull(),
  status: text().$type<'open' | 'resolved'>().notNull().default('open'),
  daysUntilProblem: integer('days_until_problem').notNull(),
  problemDate: date('problem_date').notNull(),
  accessStatus: text('access_status').$type<AccessStatus>().notNull(),
  sourceKind: text('source_kind').$type<'fill' | 'data_file' | 'call' | 'pgx'>().notNull(),
  sourceRef: text('source_ref').notNull(),
  sourceDate: date('source_date').notNull(),
  evidence: jsonb().$type<Record<string, unknown>>().notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  resolvedAt: ts('resolved_at'),
  outcome: text().$type<'happened' | 'prevented' | 'false_alarm' | 'unknown'>(),
});
