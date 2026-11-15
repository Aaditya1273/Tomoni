// Creates .env from .env.example with freshly generated local keys. Never overwrites.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) process.exit(0);
const key = () => randomBytes(32).toString('base64');
const out = readFileSync('.env.example', 'utf8')
  .replace('k1:REPLACE_ME_WITH_32_BYTES_BASE64', `k1:${key()}`)
  .replace(/REPLACE_ME_WITH_32_BYTES_BASE64/g, () => key());
writeFileSync('.env', out, { mode: 0o600 });
console.warn('created .env with new local keys');
