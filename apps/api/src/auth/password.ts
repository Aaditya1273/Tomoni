import { hash, verify } from '@node-rs/argon2';

/** argon2id, m=64 MiB, t=3, p=1 (SECURITY S8). */
const OPTS = { memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

export const hashPassword = (pw: string) => hash(pw, OPTS);

// Verifying against a fixed dummy hash when the account doesn't exist keeps response time
// the same, so login timing doesn't reveal which e-mails have accounts.
let dummy: Promise<string> | undefined;
export async function verifyPassword(stored: string | null, pw: string): Promise<boolean> {
  const target = stored ?? (await (dummy ??= hash('dummy-password-for-timing', OPTS)));
  const ok = await verify(target, pw).catch(() => false);
  return stored !== null && ok;
}
