import { getTranslations } from 'next-intl/server';
import { Headset } from 'lucide-react';
import { EmptyState } from '@tomoni/ui';
import { requireSurface } from '@tomoni/web-shared/server';
import { StaffShell } from '@/components/StaffShell';

export const metadata = { title: 'Operations' };

export default async function Ops() {
  const [me, t, ts] = await Promise.all([
    requireSurface('ops'),
    getTranslations('ops'),
    getTranslations('surfaces'),
  ]);
  return (
    <StaffShell surface="ops" me={me} title={ts('ops')}>
      <main id="main" className="flex-1 p-4">
        <h1 className="mb-3 text-lg font-semibold">{t('title')}</h1>
        <EmptyState icon={<Headset aria-hidden />} title={t('emptyTitle')} className="max-w-[40rem]">
          {t('emptyBody')}
        </EmptyState>
      </main>
    </StaffShell>
  );
}
