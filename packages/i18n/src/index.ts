import en from '../messages/en.json' with { type: 'json' };
import hi from '../messages/hi.json' with { type: 'json' };
import gu from '../messages/gu.json' with { type: 'json' };
import ta from '../messages/ta.json' with { type: 'json' };
import pa from '../messages/pa.json' with { type: 'json' };
import bn from '../messages/bn.json' with { type: 'json' };

export type Messages = typeof en;

export interface LocaleInfo {
  code: string;
  /** Name in its own script, for the language switcher. */
  nativeName: string;
  dir: 'ltr' | 'rtl';
  /** complete = every key translated and reviewed; scaffold = falls back to English. */
  status: 'complete' | 'scaffold';
}

export const LOCALES = [
  { code: 'en', nativeName: 'English', dir: 'ltr', status: 'complete' },
  { code: 'hi', nativeName: 'हिन्दी', dir: 'ltr', status: 'complete' },
  { code: 'gu', nativeName: 'ગુજરાતી', dir: 'ltr', status: 'scaffold' },
  { code: 'ta', nativeName: 'தமிழ்', dir: 'ltr', status: 'scaffold' },
  { code: 'pa', nativeName: 'ਪੰਜਾਬੀ', dir: 'ltr', status: 'scaffold' },
  { code: 'bn', nativeName: 'বাংলা', dir: 'ltr', status: 'scaffold' },
] as const satisfies readonly LocaleInfo[];

export type Locale = (typeof LOCALES)[number]['code'];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'tomoni_locale';

const raw: Record<Locale, unknown> = { en, hi, gu, ta, pa, bn };

export const isLocale = (v: unknown): v is Locale => LOCALES.some((l) => l.code === v);
export const localeInfo = (l: Locale): LocaleInfo => LOCALES.find((x) => x.code === l)!;

type Tree = { [k: string]: string | Tree };
function deepMerge(base: Tree, over: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = base[k];
    out[k] = typeof v === 'object' && typeof b === 'object' ? deepMerge(b, v) : v;
  }
  return out;
}

/** Messages for a locale, with English filling any key the locale doesn't have yet. */
export function messagesFor(locale: Locale): Messages {
  return locale === 'en' ? en : (deepMerge(en as Tree, raw[locale] as Tree) as Messages);
}

/** Pick the best supported locale from an Accept-Language header. */
export function negotiate(acceptLanguage: string | null | undefined): Locale {
  for (const part of (acceptLanguage ?? '').split(',')) {
    const tag = part.split(';')[0]!.trim().toLowerCase().split('-')[0];
    if (isLocale(tag)) return tag;
  }
  return DEFAULT_LOCALE;
}
