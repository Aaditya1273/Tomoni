import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ActionList, NurseFlagItem } from '@tomoni/contracts';
import { StatusPill } from '@tomoni/ui';
import { Decide } from '@/components/desk/Decide';
import { LiveRefresh } from '@/components/LiveRefresh';
import { drugName } from '@/lib/medicines';
import { apiGet, requireSurface } from '@tomoni/web-shared/server';
import { StaffShell } from '@/components/StaffShell';
import { FlagQueue } from '@/components/desk/FlagQueue';

export const metadata = { title: 'Care desk' };

export default async function Desk() {
  const [me, t, ts, flags, approvals] = await Promise.all([
    requireSurface('desk'),
    getTranslations('desk'),
    getTranslations('surfaces'),
    apiGet<NurseFlagItem[]>('/api/desk/flags'),
    apiGet<ActionList>('/api/desk/approvals'),
  ]);
  const canSign = me.roles.includes('physician');
  return (
    <StaffShell surface="desk" me={me} title={ts('desk')}>
      <main id="main" className="grid flex-1 gap-0 lg:grid-cols-[22rem_1fr]">
        <section aria-labelledby="queue-h" className="border-line p-4 lg:border-r">
          <h1 id="queue-h" className="mb-3 text-lg font-semibold">
            {t('queueTitle')}
          </h1>
          {/* Phase 4 adds prior authorizations, care plans and keyboard navigation (§5.6). */}
          <LiveRefresh topics={['action.proposed']} />
          {(approvals.data ?? []).length > 0 && (
            <section aria-labelledby="sign-h" className="mb-6 flex flex-col gap-2">
              <h2 id="sign-h" className="text-lg font-semibold">
                {canSign ? t('approvalsTitle') : t('approvalsTitleStaff')}
              </h2>
              <ol className="flex flex-col divide-y divide-line">
                {approvals.data!.map((a) => (
                  <li key={a.id} className="flex flex-col gap-1.5 py-3" data-approval={a.skill}>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status="watch">{a.patientName}</StatusPill>
                      <span>
                        {t(`what.${a.skill as 'draftRenewalForDoctor'}`, {
                          drug: a.facts.drug ? drugName(String(a.facts.drug)) : '',
                        })}
                      </span>
                    </div>
                    {canSign && (
                      <Decide
                        options={[
                          {
                            label: t('sign'),
                            path: `/api/actions/${a.id}/decision`,
                            body: { decision: 'approve' },
                          },
                          {
                            label: t('decline'),
                            path: `/api/actions/${a.id}/decision`,
                            body: { decision: 'reject' },
                            quiet: true,
                          },
                        ]}
                      />
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
          <FlagQueue initial={flags.data ?? []} />
          <Link
            href="/desk/simulator"
            className="mt-6 inline-block text-sm font-semibold text-neel underline underline-offset-2"
          >
            {t('simulatorLink')}
          </Link>
        </section>
        <section aria-label="Details" className="hidden items-center justify-center bg-sunken p-8 lg:flex">
          <p className="max-w-[36ch] text-center text-muted">{t('detailEmpty')}</p>
        </section>
      </main>
    </StaffShell>
  );
}
