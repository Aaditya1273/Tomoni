import { getTranslations } from 'next-intl/server';
import type { ResearchMatches } from '@tomoni/contracts';
import { apiGet, requireSurface } from '@tomoni/web-shared/server';
import { StaffShell } from '@/components/StaffShell';
import { Decide } from '@/components/desk/Decide';

export const metadata = { title: 'Research matches' };

const NEXT: Record<string, string | undefined> = {
  matched: 'prescreened',
  prescreened: 'introduced',
  introduced: 'consent_prep',
  consent_prep: 'referred',
  referred: 'randomized',
};

/** The research coordinator's funnel (Trial Bridge steps 2, 4, 5). Each step is work, some of it billable. */
export default async function AdminResearch() {
  const me = await requireSurface('admin');
  const [t, ts, res] = await Promise.all([
    getTranslations('admin.research'),
    getTranslations('surfaces'),
    apiGet<ResearchMatches>('/api/research/matches'),
  ]);
  const rows = res.data ?? [];
  return (
    <StaffShell surface="desk" me={me} title={ts('admin')}>
      <main id="main" className="flex flex-col gap-4 p-4">
        <h1 className="text-lg font-semibold">{t('title')}</h1>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-4 font-semibold">{t('patient')}</th>
                <th className="py-2 pr-4 font-semibold">{t('trial')}</th>
                <th className="py-2 pr-4 font-semibold">{t('stage')}</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const next = NEXT[m.status];
                return (
                  <tr
                    key={m.matchId}
                    className="border-b border-line"
                    data-match={m.status}
                    data-id={m.matchId}
                  >
                    <td className="py-2 pr-4">{m.patientName}</td>
                    <td className="py-2 pr-4">{m.trialTitle}</td>
                    <td className="py-2 pr-4">{t(`stages.${m.status as 'matched'}`)}</td>
                    <td className="py-2">
                      {next && (
                        <Decide
                          options={[
                            {
                              label: t('move', { stage: t(`stages.${next as 'matched'}`) }),
                              path: `/api/research/matches/${m.matchId}/stage`,
                              body: { stage: next },
                            },
                            ...(m.status !== 'referred'
                              ? [
                                  {
                                    label: t('stages.ineligible'),
                                    path: `/api/research/matches/${m.matchId}/stage`,
                                    body: { stage: 'ineligible' },
                                    quiet: true,
                                  },
                                ]
                              : []),
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </StaffShell>
  );
}
