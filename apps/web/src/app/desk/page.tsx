import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { QueueItem, TrialIntros } from '@tomoni/contracts';
import { Decide } from '@/components/desk/Decide';
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
  const clinical = me.roles.includes('physician') || me.roles.includes('nurse');
  const intros = clinical ? ((await apiGet<TrialIntros>('/api/desk/trial-intros')).data ?? []) : [];
  return (
    <StaffShell surface="desk" me={me} title={ts('desk')}>
      <main id="main" className="flex flex-1 flex-col">
        <DeskQueue initial={queue.data ?? []} canSign={me.roles.includes('physician')} />
        {intros.length > 0 && (
          <section aria-labelledby="intros-h" className="border-t border-line p-4">
            <h2 id="intros-h" className="mb-2 font-semibold">
              {t('intros.title')}
            </h2>
            <ul className="flex flex-col divide-y divide-line">
              {intros.map((i) => (
                <li
                  key={i.matchId}
                  className="flex flex-wrap items-center justify-between gap-3 py-2"
                  data-intro={i.trialTitle}
                  data-id={i.matchId}
                >
                  <span>{t('intros.card', { name: i.patientName, trial: i.trialTitle })}</span>
                  {me.roles.includes('physician') && (
                    <Decide
                      options={[
                        {
                          label: t('intros.introduced'),
                          path: `/api/desk/trial-intros/${i.matchId}`,
                          body: { outcome: 'introduced' },
                        },
                        {
                          label: t('intros.notInterested'),
                          path: `/api/desk/trial-intros/${i.matchId}`,
                          body: { outcome: 'declined' },
                          quiet: true,
                        },
                      ]}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
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
