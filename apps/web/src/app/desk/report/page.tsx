import { getFormatter, getTranslations } from 'next-intl/server';
import type { PracticeReport } from '@tomoni/contracts';
import { apiGet, requireSurface } from '@tomoni/web-shared/server';
import { StaffShell } from '@/components/StaffShell';

export const metadata = { title: 'Practice report' };

export default async function Report({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const month = /^20\d\d-(0[1-9]|1[0-2])$/.test(sp.month ?? '')
    ? sp.month!
    : (process.env.TOMONI_TODAY ?? new Date().toISOString()).slice(0, 7);
  const [me, t, f, res] = await Promise.all([
    requireSurface('desk'),
    getTranslations('desk.report'),
    getFormatter(),
    apiGet<PracticeReport>(`/api/desk/report?month=${month}`),
  ]);
  const r = res.data;
  const rows: [string, string][] = r
    ? [
        ['enrolled', String(r.enrolled)],
        ['revenue', f.number(r.apcmRevenueCents / 100, { style: 'currency', currency: 'USD' })],
        ['ready', String(r.ready + r.billed)],
        ['excluded', String(r.excluded)],
        ['calls', String(r.callsCompleted)],
        ['flags', `${r.flagsRaised} / ${r.flagsHandled}`],
        ['tasks', String(r.tasksDoneByTomoni)],
        ['caught', String(r.problemsCaughtEarly)],
      ]
    : [];
  return (
    <StaffShell surface="desk" me={me} title={t('title')}>
      <main id="main" className="flex flex-col gap-4 p-4">
        <h1 className="text-lg font-semibold">
          {t('title')} · {f.dateTime(new Date(`${month}-15T12:00:00Z`), { month: 'long', year: 'numeric' })}
        </h1>
        <dl className="grid max-w-[40rem] grid-cols-[1fr_auto] gap-x-8 gap-y-2">
          {rows.map(([k, v]) => (
            <div key={k} className="contents" data-metric={k}>
              <dt className="text-muted">{t(k)}</dt>
              <dd className="text-right font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted">{t('rateNote')}</p>
      </main>
    </StaffShell>
  );
}
