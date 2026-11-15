import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { DeskPatients } from '@tomoni/contracts';
import { apiGet, requireSurface } from '@tomoni/web-shared/server';
import { StaffShell } from '@/components/StaffShell';
import { Simulator } from '@/components/desk/Simulator';

export const metadata = { title: 'Call simulator' };

export default async function SimulatorPage() {
  if (process.env.TOMONI_SIMULATOR === 'off') notFound();
  const [me, t, patients] = await Promise.all([
    requireSurface('desk'),
    getTranslations('desk'),
    apiGet<DeskPatients>('/api/desk/patients'),
  ]);
  return (
    <StaffShell surface="desk" me={me} title={t('simTitle')}>
      <main id="main" className="flex flex-col gap-4 p-4">
        <h1 className="text-lg font-semibold">{t('simTitle')}</h1>
        <p className="max-w-[65ch] text-muted">{t('simHelp')}</p>
        <Simulator patients={patients.data ?? []} />
      </main>
    </StaffShell>
  );
}
