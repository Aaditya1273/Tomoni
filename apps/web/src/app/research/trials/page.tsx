import { getTranslations } from 'next-intl/server';
import type { TrialSetupOptions, TrialSetups } from '@tomoni/contracts';
import { StatusPill } from '@tomoni/ui';
import { apiGet, requireSurface } from '@tomoni/web-shared/server';
import { StaffShell } from '@/components/StaffShell';
import { Decide } from '@/components/desk/Decide';
import { TrialForm } from './TrialForm';

export const metadata = { title: 'Studies' };

/** The coordinator sets up studies: closed criteria, approved pre-screen questions (D-033). */
export default async function Trials() {
  const me = await requireSurface('research');
  const [t, ts, trials, options] = await Promise.all([
    getTranslations('admin.research.trials'),
    getTranslations('surfaces'),
    apiGet<TrialSetups>('/api/research/trials'),
    apiGet<TrialSetupOptions>('/api/research/setup-options'),
  ]);
  return (
    <StaffShell surface="desk" me={me} title={ts('research')}>
      <main id="main" className="grid gap-6 p-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="trials-h" className="flex flex-col gap-3">
          <h1 id="trials-h" className="text-lg font-semibold">
            {t('title')}
          </h1>
          <ul className="flex flex-col divide-y divide-line">
            {(trials.data ?? []).map((x) => (
              <li key={x.id} className="flex flex-col gap-2 py-3" data-trial={x.title}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{x.title}</span>
                  <StatusPill status={x.status === 'recruiting' ? 'ok' : 'watch'}>
                    {t(`status.${x.status}`)}
                  </StatusPill>
                </div>
                <p className="text-sm text-muted">
                  {t('meta', { sponsor: x.sponsorName, area: x.therapeuticArea, matched: x.matched })}
                  {x.nctId ? ` · ${x.nctId}` : ''}
                </p>
                <p className="text-sm">
                  {t('counts', { criteria: x.criteria.length, questions: x.questions.length })}
                </p>
                {x.status !== 'closed' && (
                  <Decide
                    options={[
                      ...(x.status === 'draft'
                        ? [
                            {
                              label: t('recruit'),
                              path: `/api/research/trials/${x.id}/status`,
                              body: { status: 'recruiting' },
                            },
                          ]
                        : []),
                      {
                        label: x.status === 'draft' ? t('discard') : t('close'),
                        path: `/api/research/trials/${x.id}/status`,
                        body: { status: 'closed' },
                        quiet: true,
                      },
                    ]}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="new-h" className="flex flex-col gap-3">
          <h2 id="new-h" className="text-lg font-semibold">
            {t('new')}
          </h2>
          {options.data && <TrialForm options={options.data} />}
        </section>
      </main>
    </StaffShell>
  );
}
