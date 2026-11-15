import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * Field-level encryption for PHI identifiers and free text (SECURITY S6, DECISIONS D-005).
 *
 * Format: [version=1][keyIdLen][keyId utf8][nonce 12][tag 16][ciphertext]
 * AAD = the column name ("care.patient.name"), so a ciphertext copied into another column
 * fails to decrypt instead of silently showing the wrong field.
 */
const VERSION = 1;

export class FieldCipher {
  private readonly keys: Map<string, Buffer>;
  private readonly activeId: string;

  constructor(keyring: string) {
    this.keys = new Map();
    for (const entry of keyring.split(',')) {
      const [id, b64] = entry.split(':');
      const key = Buffer.from(b64 ?? '', 'base64');
      if (!id || key.length !== 32) throw new Error('TOMONI_FIELD_KEYS: each entry must be <id>:<base64 32 bytes>');
      this.keys.set(id, key);
    }
    this.activeId = keyring.split(':')[0]!;
  }

  encrypt(plain: string, aad: string): Buffer {
    const nonce = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.keys.get(this.activeId)!, nonce);
    c.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    const id = Buffer.from(this.activeId);
    return Buffer.concat([Buffer.from([VERSION, id.length]), id, nonce, c.getAuthTag(), ct]);
  }

  decrypt(blob: Buffer, aad: string): string {
    if (blob[0] !== VERSION) throw new Error('unknown ciphertext version');
    const idLen = blob[1]!;
    const id = blob.subarray(2, 2 + idLen).toString();
    const key = this.keys.get(id);
    if (!key) throw new Error(`no key for key id ${id}`);
    let o = 2 + idLen;
    const nonce = blob.subarray(o, (o += 12));
    const tag = blob.subarray(o, (o += 16));
    const d = createDecipheriv('aes-256-gcm', key, nonce);
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(blob.subarray(o)), d.final()]).toString('utf8');
  }

  /** Key id a blob was written with; used by the key-rotation job. */
  static keyIdOf(blob: Buffer): string {
    return blob.subarray(2, 2 + blob[1]!).toString();
  }
}

/** Normalizers so equal values hash equally. */
export const normalize = {
  phone: (v: string) => {
    const d = v.replace(/\D/g, '');
    return d.length === 10 ? `1${d}` : d;
  },
  mbi: (v: string) => v.replace(/[\s-]/g, '').toUpperCase(),
  email: (v: string) => v.trim().toLowerCase(),
};

/** Keyed hash for equality lookups on encrypted columns. Purpose-separated. */
export function lookupHash(hmacKeyB64: string, purpose: string, value: string): Buffer {
  return createHmac('sha256', Buffer.from(hmacKeyB64, 'base64')).update(`${purpose}\0${value}`).digest();
}
