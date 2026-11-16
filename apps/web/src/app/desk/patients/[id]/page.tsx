import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { DeskPatient } from '@tomoni/contracts';
import { StatusPill } from '@tomoni/ui';
import { apiGet, requireSurface } from '@tomoni/web-shared/server';
import { StaffShell } from '@/components/StaffShell';
import { CarePlanEditor } from '@/components/desk/CarePlanEditor';
import { Decide } from '@/components/desk/Decide';
import { PgxForm } from '@/components/desk/PgxForm';
import { drugName } from '@/lib/medicines';

export const metadata = { title: 'Patient' };

export default async function DeskPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [me, t, f, res] = await Promise.all([
    requireSurface('desk'),
    getTranslations('desk'),
    getFormatter(),
    apiGet<DeskPatient>(`/api/desk/patients/${id}`),
  ]);
  if (!res.data) notFound();
  const p = res.data;
  const plan = p.carePlans[0];
  const isDoctor = me.roles.includes('physician');
  return (
    <StaffShell surface="desk" me={me} title={p.name}>
      <main id="main" className="grid flex-1 gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="plan-h" className="flex flex-col gap-3">
          <div>
            <h1 className="text-lg font-semibold">{p.name}</h1>
            <p className="text-sm text-muted">
              {t('patient.born', { year: p.birthYear })} · {p.locale} ·{' '}
              {p.apcmEnrolled ? t('patient.enrolled') : t('patient.notEnrolled')}
            </p>
          </div>
          <h2 id="plan-h" className="font-semibold">
            {t('patient.carePlan')}
          </h2>
          {!plan ? (
            <p className="text-muted">{t('patient.noPlan')}</p>
          ) : (
            <div className="flex flex-col gap-3 rounded-panel bg-surface p-4" data-plan-status={plan.status}>
              <StatusPill status={plan.status === 'signed' ? 'ok' : 'watch'} className="self-start">
                {t('patient.version', { v: plan.version, status: t(`patient.status.${plan.status}`) })}
              </StatusPill>
              {(
                [
                  ['problems', plan.body.problems.map((x) => x.name)],
                  ['goals', plan.body.goals],
                  ['medications', plan.body.medications.map(drugName)],
                  ['interventions', plan.body.interventions],
                  ['contacts', plan.body.contacts.map((c) => `${c.name} (${c.role})`)],
                ] as const
              ).map(([k, items]) => (
                <div key={k}>
                  <h3 className="text-sm font-semibold">{t(`patient.${k}`)}</h3>
                  <ul className="list-disc pl-5 text-sm">
                    {items.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              ))}
              {plan.status === 'draft' && <CarePlanEditor key={plan.revision} plan={plan} />}
              {plan.status === 'draft' && isDoctor && (
                <Decide
                  options={[
                    {
                      label: t('patient.sign'),
                      path: `/api/desk/care-plans/${plan.id}/sign`,
                      body: { revision: plan.revision }, // exactly what is on screen
                    },
                  ]}
                />
              )}
            </div>
          )}
          {(!plan || plan.status !== 'draft') && (
            <Decide
              options={[{ label: t('patient.draft'), path: `/api/desk/patients/${p.id}/care-plan/draft` }]}
            />
          )}
        </section>
        <section aria-labelledby="tl-h" className="flex flex-col gap-4">
          {isDoctor && (
            <PgxForm
              patientId={p.id}
              today={(process.env.TOMONI_TODAY ?? new Date().toISOString()).slice(0, 10)}
            />
          )}
          <h2 id="tl-h" className="font-semibold">
            {t('patient.timeline')}
          </h2>
          <ol className="flex flex-col divide-y divide-line text-sm">
            {p.timeline.map((e) => (
              <li key={`${e.kind}-${e.ref}`} className="flex gap-3 py-2" data-kind={e.kind}>
                <time className="w-24 shrink-0 text-muted tabular-nums" dateTime={e.at}>
                  {f.dateTime(new Date(e.at.length === 10 ? `${e.at}T12:00:00Z` : e.at), {
                    dateStyle: 'medium',
                  })}
                </time>
                <span>
                  {e.title}
                  {e.detail && <span className="text-muted"> · {e.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </StaffShell>
  );
}
