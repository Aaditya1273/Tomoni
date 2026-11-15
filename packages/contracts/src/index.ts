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
