import { getTranslations } from 'next-intl/server';
import { HeartHandshake } from 'lucide-react';
import { EmptyState } from '@tomoni/ui';
import { PrefsMenu } from '@tomoni/web-shared';
import { getPrefs, requireSurface } from '@tomoni/web-shared/server';
import { Greeting } from '@/components/Greeting';

export const metadata = { title: 'Today' };

export default async function FamilyToday() {
  const [me, prefs, t] = await Promise.all([requireSurface('family'), getPrefs(), getTranslations('family')]);
  const first = me.user.displayName.split(' ')[0] ?? me.user.displayName;
  return (
    <main id="main" className="flex flex-1 flex-col gap-8 pt-10">
      <Greeting name={first} />
      {/* Phase 2 replaces this with the morning family card (BUILD_PROMPT §5.5). */}
      <EmptyState icon={<HeartHandshake aria-hidden />} title={t('emptyTitle')}>
        {t('emptyBody')}
      </EmptyState>
      <div className="mt-auto border-t border-line pt-6">
        <PrefsMenu initialTheme={prefs.theme} initialLargeText={prefs.largeText} />
      </div>
    </main>
  );
}
