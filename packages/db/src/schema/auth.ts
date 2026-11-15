import { bigint, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Role } from '@tomoni/core';
import { bytea, encrypted } from '../fields';

export const auth = pgSchema('auth');

export const userAccount = auth.table('user_account', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash'),
  mfaSecret: encrypted('auth.user_account.mfa_secret'),
  mfaEnabledAt: timestamp('mfa_enabled_at', { withTimezone: true }),
  status: text().$type<'active' | 'locked' | 'disabled'>().notNull().default('active'),
  failedLogins: integer('failed_logins').notNull().default(0),
  mfaLastStep: bigint('mfa_last_step', { mode: 'number' }),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const identity = auth.table('identity', {
  userId: uuid('user_id').notNull(),
  provider: text().notNull(),
  subject: text().notNull(),
});

export const roleGrant = auth.table('role_grant', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  role: text().$type<Role>().notNull(),
  practiceId: uuid('practice_id'),
  householdId: uuid('household_id'),
  patientId: uuid('patient_id'),
  sponsorId: uuid('sponsor_id'),
  grantedBy: uuid('granted_by'),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const session = auth.table('session', {
  idHash: bytea('id_hash').primaryKey(),
  userId: uuid('user_id').notNull(),
  csrfTokenHash: bytea('csrf_token_hash').notNull(),
  mfaVerifiedAt: timestamp('mfa_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  idleTimeoutS: integer('idle_timeout_s').notNull(),
  absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  userAgent: text('user_agent'),
});

