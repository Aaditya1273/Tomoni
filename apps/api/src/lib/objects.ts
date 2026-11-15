/**
 * Object storage for evidence images (prescription photos). `LocalObjectStore` writes to
 * .data/objects; an S3-compatible adapter comes with deployment (ARCHITECTURE "Integrations").
 * Every object is AES-256-GCM encrypted with the field keyring before it touches disk, so a
 * copied bucket or disk holds no readable PHI.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cipher, repoRoot } from '@tomoni/db';

export interface ObjectStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

const SAFE_KEY = /^[a-z0-9/_.-]{1,200}$/;

export class LocalObjectStore implements ObjectStore {
  constructor(private readonly root = path.join(repoRoot(), '.data', 'objects')) {}
  private file(key: string) {
    if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error('bad object key');
    return path.join(this.root, key);
  }
  async put(key: string, bytes: Buffer) {
    const f = this.file(key);
    mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    writeFileSync(f, cipher().encrypt(bytes.toString('base64'), `object:${key}`), { mode: 0o600 });
  }
  async get(key: string) {
    try {
      return Buffer.from(cipher().decrypt(readFileSync(this.file(key)), `object:${key}`), 'base64');
    } catch {
      return null;
    }
  }
}

/** Accept only real images, by their first bytes, not by what the client claims. */
export function imageType(bytes: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
}
