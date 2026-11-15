/**
 * Rule 2.8: research-only values. A ResearchOnly<T> is an opaque box: outside this package
 * there is no way to read what is inside (the getter is not exported from the package entry),
 * and serializing one throws, so it can't slip into an API response or a message by accident.
 */
declare const researchOnly: unique symbol;
export type ResearchOnly<T> = { readonly [researchOnly]: T };

const inside = new WeakMap<object, unknown>();

class Sealed {
  toJSON(): never {
    throw new Error('ResearchOnly values cannot be serialized (rule 2.8)');
  }
  toString() {
    return '[ResearchOnly]';
  }
}

export function seal<T>(value: T): ResearchOnly<T> {
  const box = Object.freeze(new Sealed());
  inside.set(box, value);
  return box as unknown as ResearchOnly<T>;
}

/** Package-internal. Never re-export from index.ts. */
export function unseal<T>(box: ResearchOnly<T>): T {
  if (!inside.has(box)) throw new Error('not a ResearchOnly value');
  return inside.get(box) as T;
}
