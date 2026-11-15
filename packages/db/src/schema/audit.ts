import { bigint, bigserial, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea } from '../fields';

export const auditSchema = pgSchema('audit');

/** Read-only from the app: writes go through audit.append() (see ../audit.ts). */
export const auditEvent = auditSchema.table('event', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  at: timestamp({ withTimezone: true }).notNull(),
  actorKind: text('actor_kind').$type<'user' | 'system' | 'agent'>().notNull(),
  actorId: text('actor_id').notNull(),
  actorRoles: text('actor_roles').array().notNull(),
  action: text().notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  patientId: uuid('patient_id'),
  purpose: text().notNull(),
  details: jsonb().notNull(),
  chainSeq: bigint('chain_seq', { mode: 'number' }),
  prevHash: bytea('prev_hash'),
  hash: bytea('hash'),
});
