import { getTranslations } from 'next-intl/server';
import { FlaskConical } from 'lucide-react';
import { EmptyState, Notice, Wordmark } from '@tomoni/ui';
import { PrefsMenu, SignOutButton } from '@tomoni/web-shared';
import { getPrefs, requireSurface } from '@tomoni/web-shared/server';

export const metadata = { title: 'Studies' };

export default async function SponsorHome() {
  // Only sponsor_user accounts render this page; anyone else is redirected (requireSurface).
  const [me, prefs, t] = await Promise.all([
    requireSurface('sponsor', '/login?notPartner=1'),
    getPrefs(),
    getTranslations('sponsor'),
  ]);
  return (
    <div data-surface="sponsor" className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-surface px-6 py-3">
        <Wordmark className="text-lg" />
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">{me.user.displayName}</span>
          <PrefsMenu initialTheme={prefs.theme} initialLargeText={prefs.largeText} />
          <SignOutButton />
        </div>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-[64rem] flex-col gap-6 px-6 py-8">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Notice tone="info">{t('lead')}</Notice>
        {/* Phase 5: feasibility counts, referral funnel, contract usage (BUILD_PROMPT §5.8). */}
        <EmptyState icon={<FlaskConical aria-hidden />} title={t('emptyTitle')}>
          {t('emptyBody')}
        </EmptyState>
      </main>
    </div>
  );
}
