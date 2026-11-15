import { customType } from 'drizzle-orm/pg-core';
import { env } from './env';
import { FieldCipher, lookupHash, normalize } from './crypto';

let _cipher: FieldCipher | undefined;
export const cipher = () => (_cipher ??= new FieldCipher(env().TOMONI_FIELD_KEYS));

export const hashFor = {
  phone: (v: string) => lookupHash(env().TOMONI_HMAC_KEY, 'phone', normalize.phone(v)),
  mbi: (v: string) => lookupHash(env().TOMONI_HMAC_KEY, 'mbi', normalize.mbi(v)),
};

/**
 * A column that is encrypted in the app and stored as bytea. Reads decrypt transparently,
 * so the only way to see plaintext is through Drizzle with the keyring loaded.
 */
export const encrypted = (column: string) =>
  customType<{ data: string; driverData: Buffer }>({
    dataType: () => 'bytea',
    toDriver: (v) => cipher().encrypt(v, column),
    fromDriver: (v) => cipher().decrypt(v, column),
  })(column.split('.').pop()!);

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
