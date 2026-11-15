import { describe, expect, it } from 'vitest';
import { LOCALES, messagesFor, negotiate } from '../src';
import en from '../messages/en.json' with { type: 'json' };

type Tree = { [k: string]: string | Tree };
const get = (o: object, k: string) => k.split('.').reduce<unknown>((x, p) => (x as Tree)[p], o) as string;

const keys = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));

const raw = (code: string) =>
  import(`../messages/${code}.json`, { with: { type: 'json' } }).then((m) => m.default);

describe('message catalogs', () => {
  const enKeys = keys(en).sort();

  it.each(LOCALES.filter((l) => l.status === 'complete').map((l) => l.code))(
    '%s (complete) has exactly the English keys, all non-empty',
    async (code) => {
      const m = await raw(code);
      expect(keys(m).sort()).toEqual(enKeys);
      for (const k of keys(m)) expect(get(m, k)).not.toBe('');
    },
  );

  it.each(LOCALES.map((l) => l.code))('%s has no keys English lacks', async (code) => {
    for (const k of keys(await raw(code))) expect(enKeys).toContain(k);
  });

  it.each(LOCALES.map((l) => l.code))('%s keeps every {placeholder} English uses', async (code) => {
    const m = messagesFor(code as never);
    for (const k of enKeys) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(get(m, k))).toEqual(ph(get(en, k)));
    }
  });

  it('scaffold locales fall back to English for missing keys', () => {
    const gu = messagesFor('gu');
    expect(gu.common.language).toBe('ભાષા');
    expect(gu.auth.signIn).toBe(en.auth.signIn);
  });
});

describe('negotiate', () => {
  it('picks the first supported language', () => {
    expect(negotiate('fr-FR,gu-IN;q=0.9,en;q=0.8')).toBe('gu');
    expect(negotiate('hi')).toBe('hi');
    expect(negotiate('de')).toBe('en');
    expect(negotiate(null)).toBe('en');
  });
});
