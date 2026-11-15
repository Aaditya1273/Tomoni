import { getFormatter, getTranslations } from 'next-intl/server';
import { FlaskConical } from 'lucide-react';
import type { Funnel, SponsorTrials, SponsorUsage } from '@tomoni/contracts';
import { EmptyState, Notice, Wordmark } from '@tomoni/ui';
import { PrefsMenu, SignOutButton } from '@tomoni/web-shared';
import { apiGet, getPrefs, requireSurface } from '@tomoni/web-shared/server';
import { FeasibilityForm } from './FeasibilityForm';

export const metadata = { title: 'Studies' };

const STAGES = ['matched', 'prescreened', 'introduced', 'consent_prep', 'referred', 'randomized'] as const;

/** Aggregates only (rule 2.9): every number on this page came from a suppressed, rounded function. */
export default async function SponsorHome() {
  const [me, prefs, t, f, trials, usage] = await Promise.all([
    requireSurface('sponsor', '/login?notPartner=1'),
    getPrefs(),
    getTranslations('sponsor'),
    getFormatter(),
    apiGet<SponsorTrials>('/sponsor-api/trials'),
    apiGet<SponsorUsage>('/sponsor-api/usage'),
  ]);
  const list = trials.data ?? [];
  const funnels = await Promise.all(list.map((x) => apiGet<Funnel>(`/sponsor-api/trials/${x.id}/funnel`)));
  const num = (n: number | null | undefined) => (n === null || n === undefined ? t('hidden') : f.number(n));
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
      <main id="main" className="mx-auto flex w-full max-w-[64rem] flex-col gap-8 px-6 py-8">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Notice tone="info">{t('lead')}</Notice>
        {list.length === 0 ? (
          <EmptyState icon={<FlaskConical aria-hidden />} title={t('emptyTitle')}>
            {t('emptyBody')}
          </EmptyState>
        ) : (
          <section aria-labelledby="trials-h" className="flex flex-col gap-4">
            <h2 id="trials-h" className="text-lg font-semibold">
              {t('trials')}
            </h2>
            {list.map((x, i) => (
              <article key={x.id} className="rounded-panel bg-surface p-4" data-trial={x.title}>
                <h3 className="font-semibold">{x.title}</h3>
                <p className="mb-3 text-sm text-muted">
                  {x.therapeuticArea} · {x.status}
                </p>
                <h4 className="mb-1 text-sm font-semibold">{t('funnel')}</h4>
                <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm tabular-nums">
                  {STAGES.map((s) => (
                    <div key={s} className="contents" data-stage={s}>
                      <dt>{t(`stage.${s}`)}</dt>
                      <dd className="text-right">{num(funnels[i]?.data?.[s])}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </section>
        )}
        <section aria-labelledby="feas-h" className="flex flex-col gap-3">
          <h2 id="feas-h" className="text-lg font-semibold">
            {t('feasibility')}
          </h2>
          <p className="text-sm text-muted">{t('feasibilityHelp')}</p>
          <FeasibilityForm />
        </section>
        <section aria-labelledby="usage-h" className="flex flex-col gap-3">
          <h2 id="usage-h" className="text-lg font-semibold">
            {t('usage')}
          </h2>
          {(usage.data ?? []).length === 0 ? (
            <p className="text-muted">{t('noUsage')}</p>
          ) : (
            <table className="text-left text-sm tabular-nums">
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <th className="py-1 pr-4 font-semibold">{t('month')}</th>
                  <th className="py-1 pr-4 font-semibold">{t('unit')}</th>
                  <th className="py-1 pr-4 text-right font-semibold">{t('units')}</th>
                  <th className="py-1 text-right font-semibold">{t('amount')}</th>
                </tr>
              </thead>
              <tbody>
                {usage.data!.map((u) => (
                  <tr key={`${u.month}-${u.unit}`} className="border-b border-line" data-usage={u.unit}>
                    <td className="py-1 pr-4">{u.month}</td>
                    <td className="py-1 pr-4">{u.unit.replaceAll('_', ' ')}</td>
                    <td className="py-1 pr-4 text-right">{u.units}</td>
                    <td className="py-1 text-right">
                      {f.number(u.amountCents / 100, { style: 'currency', currency: 'USD' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
