import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import type { Activity } from '@tomoni/contracts';
import { apiGet, getPrefs, requireSurface } from '@tomoni/web-shared/server';
import { drugName } from '@/lib/medicines';

export const metadata = { title: 'What Tomoni did' };

/** Everything Tomoni did for the household in the last 30 days, in plain words (§5.5). */
export default async function ActivityPage() {
  await requireSurface('family');
  const [t, f, res, prefs] = await Promise.all([
    getTranslations('family'),
    getFormatter(),
    apiGet<Activity>('/api/family/activity'),
    getPrefs(),
  ]);
  const events = res.data?.events ?? [];
  return (
    <main id="main" className="flex flex-1 flex-col gap-6 pt-8">
      <Link href="/family" className="inline-flex items-center gap-2 self-start font-semibold text-neel">
        <ArrowLeft aria-hidden className="size-5" />
        {t('evidence.back')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('activity.title')}</h1>
      {events.length === 0 ? (
        <p className="text-muted">{t('activity.empty')}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {events.map((e, i) => {
            const skill = e.facts.skill ? t(`activity.skill.${e.facts.skill as 'findStock'}`) : '';
            const type = e.facts.type ? t(`activity.type.${e.facts.type as 'run_out'}`) : '';
            const drug = e.facts.drug ? ` (${drugName(String(e.facts.drug))})` : '';
            return (
              <li key={i} className="flex flex-col py-3" data-activity={e.what}>
                <span>
                  {t(`activity.what.${e.what as 'call.completed'}`, { name: e.patientName, skill, type })}
                  {e.kind !== 'call' && e.kind !== 'flag' ? drug : ''}
                </span>
                <time className="text-sm text-muted" dateTime={e.at}>
                  {f.dateTime(new Date(e.at), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: prefs.timeZone,
                  })}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
