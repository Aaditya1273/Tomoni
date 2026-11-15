import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Me, SandboxStatus } from '@tomoni/contracts';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, negotiate, type Locale } from '@tomoni/i18n';

const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000';

/** Server component → API, forwarding the browser's cookies. GET only. */
export async function apiGet<T>(path: string): Promise<{ status: number; data: T | null }> {
  const cookie = (await cookies()).toString();
  const res = await fetch(`${API}${path}`, { headers: cookie ? { cookie } : {}, cache: 'no-store' });
  return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
}

export async function getMe(): Promise<Me | null> {
  return (await apiGet<Me>('/api/me')).data;
}

/**
 * Page guard: signed in, MFA done where required, and allowed on this surface.
 * Redirects otherwise, so a page body only ever renders for the right person.
 */
export async function requireSurface(surface: Me['surfaces'][number], otherwise = '/'): Promise<Me> {
  const me = await getMe();
  if (!me) redirect('/login');
  if (me.mfa.required && !me.mfa.verified) redirect('/mfa');
  if (!me.surfaces.includes(surface)) redirect(otherwise);
  return me;
}

export async function getSandbox(): Promise<SandboxStatus> {
  // Same for every user and changes only on deploy: cache briefly instead of asking per render.
  const data = await fetch(`${API}/api/system/sandbox`, { next: { revalidate: 30 } })
    .then((r) => (r.ok ? (r.json() as Promise<SandboxStatus>) : null))
    .catch(() => null);
  // If the API can't say, assume sandbox: the badge must never be missing by accident.
  return data ?? { sandbox: true, mockAdapters: [], realDataEnabled: false };
}

export interface Prefs {
  locale: Locale;
  theme: 'light' | 'dark' | 'system';
  largeText: boolean;
}

export async function getPrefs(): Promise<Prefs> {
  const c = await cookies();
  const fromCookie = c.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(fromCookie)
    ? fromCookie
    : (negotiate((await headers()).get('accept-language')) ?? DEFAULT_LOCALE);
  const t = c.get('tomoni_theme')?.value;
  return {
    locale,
    theme: t === 'light' || t === 'dark' ? t : 'system',
    largeText: c.get('tomoni_text')?.value === 'large',
  };
}

export async function getNonce(): Promise<string | undefined> {
  return (await headers()).get('x-nonce') ?? undefined;
}
