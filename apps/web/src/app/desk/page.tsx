import { getTranslations } from 'next-intl/server';
import { Inbox } from 'lucide-react';
import { EmptyState } from '@tomoni/ui';
import { requireSurface } from '@tomoni/web-shared/server';
import { StaffShell } from '@/components/StaffShell';

export const metadata = { title: 'Care desk' };

export default async function Desk() {
  const [me, t, ts] = await Promise.all([
    requireSurface('desk'),
    getTranslations('desk'),
    getTranslations('surfaces'),
  ]);
  return (
    <StaffShell surface="desk" me={me} title={ts('desk')}>
      <main id="main" className="grid flex-1 gap-0 lg:grid-cols-[22rem_1fr]">
        <section aria-labelledby="queue-h" className="border-line p-4 lg:border-r">
          <h1 id="queue-h" className="mb-3 text-lg font-semibold">
            {t('queueTitle')}
          </h1>
          {/* Phase 4 fills the queue (BUILD_PROMPT §5.6). */}
          <EmptyState icon={<Inbox aria-hidden />} title={t('queueEmptyTitle')}>
            {t('queueEmptyBody')}
          </EmptyState>
        </section>
        <section aria-label="Details" className="hidden items-center justify-center bg-sunken p-8 lg:flex">
          <p className="max-w-[36ch] text-center text-muted">{t('detailEmpty')}</p>
        </section>
      </main>
    </StaffShell>
  );
}
