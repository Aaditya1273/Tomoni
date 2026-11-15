import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { HeartHandshake } from 'lucide-react';
import type { Activity, FamilyCard } from '@tomoni/contracts';
import { EmptyState, Notice, StatusPill } from '@tomoni/ui';
import { PrefsMenu } from '@tomoni/web-shared';
import { apiGet, getPrefs, getSandbox, requireSurface } from '@tomoni/web-shared/server';
import { Greeting } from '@/components/Greeting';
import { ConnectMedicare } from '@/components/family/ConnectMedicare';
import { AddMedicine } from '@/components/family/AddMedicine';
import { ActionControls } from '@/components/family/ActionControls';
import { LiveRefresh } from '@/components/LiveRefresh';
import { warningWords } from '@/components/family/WarningText';
import { day, drugName, statusOf } from '@/lib/medicines';

export const metadata = { title: 'Today' };

const NOTICES = ['connected', 'expired', 'declined', 'failed'] as const;

export default async function FamilyToday({
  searchParams,
}: {
  searchParams: Promise<{ medicare?: string }>;
}) {
  const [me, prefs, t, f, sandbox, card, sp] = await Promise.all([
    requireSurface('family'),
    getPrefs(),
    getTranslations('family'),
    getFormatter(),
    getSandbox(),
    apiGet<FamilyCard>('/api/family/card'),
    searchParams,
  ]);
  const activity = (await apiGet<Activity>('/api/family/activity')).data;
  const first = me.user.displayName.split(' ')[0] ?? me.user.displayName;
  const patients = card.data?.patients ?? [];
  const asOf = card.data?.asOf ?? '';
  const all = patients.flatMap((p) => p.warnings);
  const red = all.filter((w) => w.access === 'red').length;
  const amber = all.filter((w) => w.access === 'amber').length;
  const notice = NOTICES.find((n) => n === sp.medicare);
  const statusWord = { red: t('statusRed'), amber: t('statusAmber'), green: t('statusGreen') };
  const bbMock = sandbox.mockAdapters.includes('bluebutton');

  return (
    <main id="main" className="flex flex-1 flex-col gap-8 pt-10">
      <LiveRefresh topics={['action.proposed', 'action.succeeded', 'action.handoff', 'flag.created']} />
      <div className="flex flex-col gap-2">
        <Greeting name={first} />
        {patients.length > 0 && (
          <p className="text-lg">
            {red
              ? t('summaryNeedsYou', { count: red })
              : amber
                ? t('summaryComingUp', { count: amber })
                : t('summaryClear')}
          </p>
        )}
        {asOf && (
          <p className="text-sm text-muted">
            {t('asOf', { date: f.dateTime(day(asOf), { dateStyle: 'medium' }) })}
          </p>
        )}
        {activity &&
          patients.length > 0 &&
          activity.week.calls + activity.week.tasksDone + activity.week.problemsCaught > 0 && (
            <p className="text-sm" data-week>
              {t('week', {
                calls: activity.week.calls,
                caught: activity.week.problemsCaught,
                tasks: activity.week.tasksDone,
                minutes: activity.week.minutesSaved,
              })}{' '}
              <Link href="/family/activity" className="font-semibold text-neel underline underline-offset-2">
                {t('activityLink')}
              </Link>
            </p>
          )}
      </div>

      {notice && (
        <Notice tone={notice === 'connected' ? 'ok' : 'watch'}>{t(`medicareNotice.${notice}`)}</Notice>
      )}

      {patients.length === 0 && (
        <EmptyState icon={<HeartHandshake aria-hidden />} title={t('emptyTitle')}>
          {t('emptyBody')}
        </EmptyState>
      )}

      {await Promise.all(
        patients.map(async (p) => {
          const words = await Promise.all(p.warnings.map((w) => warningWords(w, asOf)));
          return (
            <section
              key={p.id}
              aria-labelledby={`p-${p.id}`}
              className="flex flex-col gap-5"
              data-patient={p.name}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
                <h2 id={`p-${p.id}`} className="text-2xl font-semibold">
                  {p.name}
                </h2>
                <StatusPill status={statusOf[p.access]}>{statusWord[p.access]}</StatusPill>
              </div>
              {(() => {
                const st = activity?.streaks.find((x) => x.patientId === p.id);
                return st && st.callStreak > 0 ? (
                  <p className="-mt-2 text-sm font-semibold text-jamun" data-streak={st.callStreak}>
                    {t('streak', { days: st.callStreak })}
                    {st.shieldUsed && <span className="font-normal text-muted"> · {t('shield')}</span>}
                  </p>
                ) : null;
              })()}

              {p.warnings.length > 0 && (
                <ol className="flex flex-col divide-y divide-line">
                  {p.warnings.map((w, i) => (
                    <li key={w.id} className="flex flex-col gap-2 py-4 first:pt-0" data-warning={w.type}>
                      <StatusPill status={statusOf[w.access]} className="self-start">
                        {words[i]!.when}
                      </StatusPill>
                      <p className="text-pretty">{words[i]!.sentence}</p>
                      {p.region === 'US' && (
                        <ActionControls
                          warningId={w.id}
                          drug={w.drug ? drugName(w.drug) : ''}
                          {...(p.actions.findLast((a) => a.warningId === w.id)
                            ? { action: p.actions.findLast((a) => a.warningId === w.id)! }
                            : {})}
                        />
                      )}
                      <p className="text-sm text-muted">
                        {words[i]!.source}.{' '}
                        <Link
                          href={`/family/warnings/${w.id}`}
                          className="font-semibold text-neel underline underline-offset-2"
                        >
                          {t('seeEvidence')}
                        </Link>
                      </p>
                    </li>
                  ))}
                </ol>
              )}

              <div className="flex flex-col gap-2">
                <h3 className="font-semibold">{t('medicinesHeading')}</h3>
                {p.medicines.length === 0 ? (
                  <p className="text-muted">{t('noMedicines')}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-line rounded-panel bg-surface px-4">
                    {p.medicines.map((m) => (
                      <li
                        key={m.id}
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3"
                      >
                        <div className="flex flex-col">
                          <span>{drugName(m.name)}</span>
                          {m.runOutDate && (
                            <span className="text-sm text-muted">
                              {t(m.runOutDate >= asOf ? 'runsOut' : 'supplyEnded', {
                                date: f.dateTime(day(m.runOutDate), { month: 'short', day: 'numeric' }),
                              })}
                            </span>
                          )}
                        </div>
                        <StatusPill status={statusOf[m.access]}>
                          {m.access === 'green' ? t('medicineOk') : statusWord[m.access]}
                        </StatusPill>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {p.region === 'IN' ? (
                <AddMedicine patientId={p.id} today={asOf} />
              ) : p.medicare ? (
                <p className="text-sm text-muted">
                  {p.medicare.mode === 'mock' ? t('medicareConnectedMock') : t('medicareConnected')}
                  {p.medicare.lastSyncedAt &&
                    `, ${t('medicareSynced', { date: f.dateTime(new Date(p.medicare.lastSyncedAt), { dateStyle: 'medium' }) })}`}
                </p>
              ) : (
                <ConnectMedicare patientId={p.id} name={p.name} sandbox={bbMock} />
              )}
            </section>
          );
        }),
      )}

      <Link
        href="/family/invite"
        className="self-start font-semibold text-jamun underline underline-offset-2"
      >
        {t('inviteLink')}
      </Link>

      <div className="mt-auto border-t border-line pt-6">
        <PrefsMenu initialTheme={prefs.theme} initialLargeText={prefs.largeText} />
      </div>
    </main>
  );
}
