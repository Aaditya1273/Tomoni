import { getTranslations } from 'next-intl/server';
import { Headset } from 'lucide-react';
import { EmptyState } from '@tomoni/ui';
import type { ActionList } from '@tomoni/contracts';
import { apiGet, requireSurface } from '@tomoni/web-shared/server';
import { StaffShell } from '@/components/StaffShell';
import { Decide } from '@/components/desk/Decide';
import { LiveRefresh } from '@/components/LiveRefresh';

export const metadata = { title: 'Operations' };

export default async function Ops() {
  const [me, t, ts, handoffs] = await Promise.all([
    requireSurface('ops'),
    getTranslations('ops'),
    getTranslations('surfaces'),
    apiGet<ActionList>('/api/ops/handoffs'),
  ]);
  const items = handoffs.data ?? [];
  return (
    <StaffShell surface="ops" me={me} title={ts('ops')}>
      <main id="main" className="flex-1 p-4">
        <h1 className="mb-3 text-lg font-semibold">{t('title')}</h1>
        <LiveRefresh topics={['action.handoff']} />
        {items.length === 0 ? (
          <EmptyState icon={<Headset aria-hidden />} title={t('emptyTitle')} className="max-w-[40rem]">
            {t('emptyBody')}
          </EmptyState>
        ) : (
          <section aria-labelledby="handoff-h">
            <h2 id="handoff-h" className="mb-2 font-semibold">
              {t('handoffsTitle')}
            </h2>
            <table className="w-full max-w-[60rem] text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-4 font-semibold">{t('patient')}</th>
                  <th className="py-2 pr-4 font-semibold">{t('skill')}</th>
                  <th className="py-2 pr-4 font-semibold">{t('since')}</th>
                  <th className="py-2 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="border-b border-line" data-handoff={a.skill}>
                    <td className="py-2 pr-4">{a.patientName}</td>
                    <td className="py-2 pr-4">{a.skill}</td>
                    <td className="py-2 pr-4 tabular-nums">{a.updatedAt.slice(0, 16).replace('T', ' ')}</td>
                    <td className="py-2">
                      <Decide
                        options={[
                          { label: t('retry'), path: `/api/ops/actions/${a.id}/retry` },
                          { label: t('cancel'), path: `/api/ops/actions/${a.id}/cancel`, quiet: true },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </StaffShell>
  );
}
