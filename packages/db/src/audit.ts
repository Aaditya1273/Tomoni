import { sql } from 'drizzle-orm';
import type { Db } from './client';

export type AuditAction =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'export'
  | 'consent_change'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'mfa_enrolled'
  | 'agent_action'
  | 'approval';
export type AuditPurpose = 'treatment' | 'operations' | 'payment' | 'research' | 'support' | 'security';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  patientId?: string | null;
  purpose: AuditPurpose;
  /** Ids and field names only. Never PHI values. */
  details?: Record<string, string | number | boolean | null | string[]>;
}

/** Append to the audit log inside the caller's transaction (actor comes from the scope). */
export async function audit(db: Db, e: AuditEntry): Promise<void> {
  await db.execute(
    sql`SELECT audit.append(${e.action}, ${e.entityType}, ${e.entityId ?? null}, ${e.patientId ?? null}::uuid,
                            ${e.purpose}, ${JSON.stringify(e.details ?? {})}::jsonb)`,
  );
}
