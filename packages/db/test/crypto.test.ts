import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, FieldCipher, lookupHash, normalize, pool } from '../src';
import { buildWorld } from './fixtures';

const key = () => randomBytes(32).toString('base64');

describe('SECURITY S6: field encryption', () => {
  const c = new FieldCipher(`k1:${key()}`);

  it('round-trips', () => {
    expect(c.decrypt(c.encrypt('Raj Patel', 'care.patient.name'), 'care.patient.name')).toBe('Raj Patel');
  });
  it('uses a fresh nonce every time', () => {
    expect(c.encrypt('x', 'a').equals(c.encrypt('x', 'a'))).toBe(false);
  });
  it('fails if the ciphertext is moved to another column', () => {
    expect(() => c.decrypt(c.encrypt('x', 'care.patient.name'), 'care.patient.phone')).toThrow();
  });
  it('fails on tampering', () => {
    const b = c.encrypt('x', 'a');
    b[b.length - 1]! ^= 1;
    expect(() => c.decrypt(b, 'a')).toThrow();
  });
  it('decrypts old keys after rotation, encrypts with the first key', () => {
    const k1 = key();
    const old = new FieldCipher(`k1:${k1}`).encrypt('x', 'a');
    const rotated = new FieldCipher(`k2:${key()},k1:${k1}`);
    expect(rotated.decrypt(old, 'a')).toBe('x');
    expect(FieldCipher.keyIdOf(rotated.encrypt('x', 'a'))).toBe('k2');
  });
  it('rejects malformed keyrings', () => {
    expect(() => new FieldCipher('k1:short')).toThrow();
  });
  it('lookup hashes are stable across formatting and purpose-separated', () => {
    const k = key();
    expect(lookupHash(k, 'phone', normalize.phone('(201) 555-0101'))).toEqual(
      lookupHash(k, 'phone', normalize.phone('+1 201 555 0101')),
    );
    expect(lookupHash(k, 'phone', '1')).not.toEqual(lookupHash(k, 'mbi', '1'));
  });
});

describe('PHI is not stored in plaintext', () => {
  beforeAll(buildWorld);
  afterAll(closePools);
  it('raw bytea for name, dob and phone does not contain the plaintext', async () => {
    const { rows } = await pool('owner').query(`SELECT name, dob, phone FROM care.patient`);
    const raw = Buffer.concat(rows.flatMap((r) => [r.name, r.dob, r.phone])).toString('latin1');
    for (const s of ['Raj Patel', '1953-04-02', '201-555-0101', 'Lata']) expect(raw).not.toContain(s);
  });
});
