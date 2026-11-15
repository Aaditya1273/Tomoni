'use client';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { LOCALES, LOCALE_COOKIE } from '@tomoni/i18n';
import { Languages, Moon, Sun, MonitorSmartphone, ALargeSmall } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@tomoni/ui';

const YEAR = 60 * 60 * 24 * 365;
const setCookie = (k: string, v: string) => {
  document.cookie = `${k}=${v}; path=/; max-age=${YEAR}; samesite=lax`;
};

/** Language, theme and text size. Stored in cookies so the server renders the right <html> first time. */
export function PrefsMenu({
  initialTheme,
  initialLargeText,
  className,
}: {
  initialTheme: 'light' | 'dark' | 'system';
  initialLargeText: boolean;
  className?: string;
}) {
  const t = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [theme, setTheme] = useState<string>(initialTheme);
  const [large, setLarge] = useState(initialLargeText);

  const changeTheme = (v: string) => {
    setTheme(v);
    if (v === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = v;
    setCookie('tomoni_theme', v);
  };
  const toggleLarge = () => {
    const next = !large;
    setLarge(next);
    if (next) document.documentElement.dataset.text = 'large';
    else delete document.documentElement.dataset.text;
    setCookie('tomoni_text', next ? 'large' : 'normal');
  };

  const seg = 'inline-flex min-h-target min-w-target items-center justify-center rounded-control';
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <label className="inline-flex items-center gap-2">
        <Languages aria-hidden className="size-5 text-muted" />
        <span className="sr-only">{t('language')}</span>
        <select
          value={locale}
          onChange={(e) => {
            setCookie(LOCALE_COOKIE, e.target.value);
            router.refresh();
          }}
          className="min-h-target rounded-control border border-line-strong bg-surface px-2"
        >
          {LOCALES.map((l) => (
            <option key={l.code} value={l.code} lang={l.code}>
              {l.nativeName}
            </option>
          ))}
        </select>
      </label>
      <div
        role="radiogroup"
        aria-label={t('theme')}
        className="inline-flex rounded-control border border-line-strong bg-surface"
      >
        {(
          [
            ['light', Sun, t('themeLight')],
            ['dark', Moon, t('themeDark')],
            ['system', MonitorSmartphone, t('themeSystem')],
          ] as const
        ).map(([v, Icon, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={theme === v}
            aria-label={label}
            title={label}
            onClick={() => changeTheme(v)}
            className={cn(seg, theme === v ? 'bg-neel-soft text-neel' : 'text-muted hover:text-ink')}
          >
            <Icon aria-hidden className="size-5" />
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={large}
        onClick={toggleLarge}
        className={cn(
          seg,
          'gap-1.5 border border-line-strong px-3',
          large ? 'bg-neel-soft text-neel' : 'bg-surface text-muted hover:text-ink',
        )}
      >
        <ALargeSmall aria-hidden className="size-5" />
        <span>{t('largeText')}</span>
      </button>
    </div>
  );
}
