import { generateSecret, generateURI, verify } from 'otplib';

export const newTotpSecret = () => generateSecret();

export const totpUri = (secret: string, label: string) => generateURI({ issuer: 'Tomoni', label, secret });

/**
 * Verify a 6-digit code with ±1 step tolerance. Returns the time step it matched so the caller
 * can claim it once (replay protection), or null.
 */
export async function verifyTotp(
  secret: string,
  code: string,
  afterStep: number | null,
): Promise<number | null> {
  const r = await verify({
    secret,
    token: code,
    epochTolerance: 30,
    ...(afterStep !== null ? { afterTimeStep: afterStep } : {}),
  });
  if (!r.valid) return null;
  return 'timeStep' in r && typeof r.timeStep === 'number' ? r.timeStep : Math.floor(Date.now() / 30_000);
}
