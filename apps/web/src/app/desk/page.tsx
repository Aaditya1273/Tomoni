import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { NurseFlagItem } from '@tomoni/contracts';
import { apiGet, requireSurface } from '@tomoni/web-shared/server';
import { StaffShell } from '@/components/StaffShell';
import { FlagQueue } from '@/components/desk/FlagQueue';

export const metadata = { title: 'Care desk' };

export default async function Desk() {
  const [me, t, ts, flags] = await Promise.all([
    requireSurface('desk'),
    getTranslations('desk'),
    getTranslations('surfaces'),
    apiGet<NurseFlagItem[]>('/api/desk/flags'),
  ]);
  return (
    <StaffShell surface="desk" me={me} title={ts('desk')}>
      <main id="main" className="grid flex-1 gap-0 lg:grid-cols-[22rem_1fr]">
        <section aria-labelledby="queue-h" className="border-line p-4 lg:border-r">
          <h1 id="queue-h" className="mb-3 text-lg font-semibold">
            {t('queueTitle')}
          </h1>
          {/* Phase 4 adds renewals, prior authorizations and care plans to the queue (§5.6). */}
          <FlagQueue initial={flags.data ?? []} />
          <Link
            href="/desk/simulator"
            className="mt-6 inline-block text-sm font-semibold text-neel underline underline-offset-2"
          >
            {t('simulatorLink')}
          </Link>
        </section>
        <section aria-label="Details" className="hidden items-center justify-center bg-sunken p-8 lg:flex">
          <p className="max-w-[36ch] text-center text-muted">{t('detailEmpty')}</p>
        </section>
      </main>
    </StaffShell>
  );
}
