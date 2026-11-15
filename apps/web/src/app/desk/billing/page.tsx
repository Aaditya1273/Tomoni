import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { ApcmList } from '@tomoni/contracts';
import { StatusPill } from '@tomoni/ui';
import { apiGet, requireSurface } from '@tomoni/web-shared/server';
import { StaffShell } from '@/components/StaffShell';
import { Decide } from '@/components/desk/Decide';

export const metadata = { title: 'APCM billing' };

const thisMonth = () => (process.env.TOMONI_TODAY ?? new Date().toISOString()).slice(0, 7);

/** The monthly APCM list (BUILD_PROMPT §5.6): what is billable, why, and the evidence behind it. */
export default async function Billing({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const month = /^20\d\d-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : thisMonth();
  const [me, t, f, list] = await Promise.all([
    requireSurface('desk'),
    getTranslations('desk.billing'),
    getFormatter(),
    apiGet<ApcmList>(`/api/desk/apcm?month=${month}`),
  ]);
  const rows = list.data ?? [];
  const canBill = me.roles.includes('physician') || me.roles.includes('front_desk');
  const money = (c: number | null) =>
    c === null ? '—' : f.number(c / 100, { style: 'currency', currency: 'USD' });
  return (
    <StaffShell surface="desk" me={me} title={t('title')}>
      <main id="main" className="flex flex-col gap-4 p-4">
        <h1 className="text-lg font-semibold">{t('title')}</h1>
        <div className="flex flex-wrap items-end gap-3">
          <form className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="month" className="text-sm font-semibold">
                {t('month')}
              </label>
              <input
                id="month"
                name="month"
                type="month"
                defaultValue={month}
                className="min-h-target rounded-control border border-line-strong bg-surface px-2"
              />
            </div>
            <button
              type="submit"
              className="min-h-target rounded-control border border-line-strong px-3 text-sm font-semibold"
            >
              {t('show')}
            </button>
          </form>
          <Decide options={[{ label: t('build'), path: '/api/desk/apcm/build', body: { month } }]} />
          {canBill && rows.length > 0 && (
            <a
              href={`/api/desk/apcm/export?month=${month}`}
              className="text-sm font-semibold text-neel underline underline-offset-2"
            >
              {t('export')}
            </a>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="text-muted">{t('empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-line">
                  {['patient', 'code', 'conditions', 'services', 'status', 'rate'].map((h) => (
                    <th key={h} className="py-2 pr-4 font-semibold">
                      {t(h)}
                    </th>
                  ))}
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line" data-apcm={r.status}>
                    <td className="py-2 pr-4">
                      <Link
                        href={`/desk/patients/${r.patientId}`}
                        className="text-neel underline underline-offset-2"
                      >
                        {r.patientName}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{r.hcpcs ?? '—'}</td>
                    <td className="py-2 pr-4">{r.chronicConditions.length}</td>
                    <td className="py-2 pr-4 tabular-nums">{r.services}</td>
                    <td className="py-2 pr-4">
                      <StatusPill status={r.status === 'excluded' ? 'watch' : 'ok'}>
                        {t(`statusName.${r.status}`)}
                      </StatusPill>
                      {r.exclusionReason && <span className="block text-muted">{r.exclusionReason}</span>}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{money(r.rateCents)}</td>
                    <td className="py-2">
                      {canBill && r.status === 'ready' && (
                        <Decide
                          options={[
                            { label: t('markBilled'), path: `/api/desk/apcm/${r.id}/billed`, quiet: true },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </StaffShell>
  );
}
