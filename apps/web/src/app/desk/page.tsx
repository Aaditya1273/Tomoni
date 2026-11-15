import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { QueueItem } from '@tomoni/contracts';
import { apiGet, requireSurface } from '@tomoni/web-shared/server';
import { StaffShell } from '@/components/StaffShell';
import { DeskQueue } from '@/components/desk/DeskQueue';

export const metadata = { title: 'Care desk' };

export default async function Desk() {
  const [me, t, ts, queue] = await Promise.all([
    requireSurface('desk'),
    getTranslations('desk'),
    getTranslations('surfaces'),
    apiGet<QueueItem[]>('/api/desk/queue'),
  ]);
  return (
    <StaffShell surface="desk" me={me} title={ts('desk')}>
      <main id="main" className="flex flex-1 flex-col">
        <DeskQueue initial={queue.data ?? []} canSign={me.roles.includes('physician')} />
        <Link
          href="/desk/simulator"
          className="m-4 text-sm font-semibold text-neel underline underline-offset-2"
        >
          {t('simulatorLink')}
        </Link>
      </main>
    </StaffShell>
  );
}
