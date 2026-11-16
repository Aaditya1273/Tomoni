import type { ReactNode } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Wordmark } from '@tomoni/ui';
import { PrefsMenu, SignOutButton } from '@tomoni/web-shared';
import { getPrefs } from '@tomoni/web-shared/server';
import type { Me } from '@tomoni/contracts';
import { ShortcutHelp } from './ShortcutHelp';

/** Desk and ops chrome: one dense top bar, the rest of the viewport is work. */
export async function StaffShell({
  surface,
  me,
  title,
  children,
}: {
  surface: 'desk' | 'ops';
  me: Me;
  title: string;
  children: ReactNode;
}) {
  const [prefs, ta, td] = await Promise.all([getPrefs(), getTranslations('admin'), getTranslations('desk')]);
  return (
    <div data-surface={surface} className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-surface px-4 py-2">
        <Wordmark className="text-lg" />
        <p className="font-semibold">{title}</p>
        {surface === 'desk' && me.surfaces.includes('desk') && (
          <nav aria-label="Desk" className="flex gap-4 text-sm font-semibold">
            <Link href="/desk" className="text-neel">
              {td('nav.queue')}
            </Link>
            <Link href="/desk/billing" className="text-neel">
              {td('nav.billing')}
            </Link>
            <Link href="/desk/report" className="text-neel">
              {td('nav.report')}
            </Link>
          </nav>
        )}
        {me.surfaces.includes('research') && (
          <nav aria-label="Research" className="flex gap-4 text-sm font-semibold">
            <Link href="/research" className="text-neel">
              {ta('research.nav.matches')}
            </Link>
            <Link href="/research/trials" className="text-neel">
              {ta('research.nav.trials')}
            </Link>
          </nav>
        )}
        {me.surfaces.includes('admin') && (
          <nav aria-label="Admin">
            <Link href="/admin/data" className="text-sm font-semibold text-neel underline underline-offset-2">
              {ta('dataTitle')}
            </Link>
          </nav>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <ShortcutHelp />
          <span className="text-sm text-muted">{me.user.displayName}</span>
          <PrefsMenu initialTheme={prefs.theme} initialLargeText={prefs.largeText} />
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
