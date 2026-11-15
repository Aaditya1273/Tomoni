import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import type { WarningEvidence } from '@tomoni/contracts';
import { StatusPill } from '@tomoni/ui';
import { apiGet, requireSurface } from '@tomoni/web-shared/server';
import { warningWords } from '@/components/family/WarningText';
import { day, drugName, statusOf } from '@/lib/medicines';

export const metadata = { title: 'Where this comes from' };

/** The evidence behind one warning (BUILD_PROMPT §5.2): the exact claims or file versions it rests on. */
export default async function Evidence({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSurface('family');
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [res, t, f] = await Promise.all([
    apiGet<WarningEvidence>(`/api/warnings/${id}`),
    getTranslations('family'),
    getFormatter(),
  ]);
  if (!res.data) notFound();
  const { warning: w, fills, files } = res.data;
  const words = await warningWords(w, w.createdAt.slice(0, 10));
  const d = (iso: string) => f.dateTime(day(iso), { dateStyle: 'medium' });

  return (
    <main id="main" className="flex flex-1 flex-col gap-8 pt-8">
      <Link href="/family" className="inline-flex items-center gap-2 self-start font-semibold text-neel">
        <ArrowLeft aria-hidden className="size-5" />
        {t('evidence.back')}
      </Link>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{t('evidence.title')}</h1>
        <StatusPill status={statusOf[w.access]} className="self-start">
          {words.when}
        </StatusPill>
        <p className="text-lg text-pretty">{words.sentence}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        <dt className="text-muted">{t('evidence.who')}</dt>
        <dd>{w.patientName}</dd>
        <dt className="text-muted">{t('evidence.when')}</dt>
        <dd>{d(w.problemDate)}</dd>
        <dt className="text-muted">{t('evidence.found')}</dt>
        <dd>{f.dateTime(new Date(w.createdAt), { dateStyle: 'medium' })}</dd>
        <dt className="text-muted">{t('evidence.status')}</dt>
        <dd>{w.status === 'open' ? t('evidence.open') : t('evidence.resolved')}</dd>
      </dl>

      {fills.length > 0 && (
        <section aria-labelledby="fills-h" className="flex flex-col gap-3">
          <h2 id="fills-h" className="text-xl font-semibold">
            {t('evidence.fillsHeading')}
          </h2>
          {w.source.kind === 'fill' && <p className="text-sm text-muted">{words.source}</p>}
          <ul className="flex flex-col divide-y divide-line rounded-panel bg-surface px-4">
            {fills.map((x) => (
              <li key={x.id} className="py-3">
                <p className="font-semibold">{drugName(x.drug)}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 text-sm">
                  <dt className="text-muted">{t('evidence.fillDate')}</dt>
                  <dd>{d(x.fillDate)}</dd>
                  <dt className="text-muted">{t('evidence.daysSupply')}</dt>
                  <dd className="tabular-nums">{x.daysSupply}</dd>
                  <dt className="text-muted">{t('evidence.pharmacy')}</dt>
                  <dd>{x.pharmacy ?? t('evidence.unknownPharmacy')}</dd>
                  <dt className="text-muted">{t('evidence.claimId')}</dt>
                  <dd className="break-all">{x.sourceRef}</dd>
                </dl>
                {x.hasPhoto && (
                  <a
                    href={`/api/fills/${x.id}/photo`}
                    className="text-sm font-semibold text-neel underline underline-offset-2"
                  >
                    {t('addMed.photoLink')}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {files.length > 0 && (
        <section aria-labelledby="files-h" className="flex flex-col gap-3">
          <h2 id="files-h" className="text-xl font-semibold">
            {t('evidence.filesHeading')}
          </h2>
          <ul className="flex flex-col divide-y divide-line rounded-panel bg-surface px-4">
            {files.map((v) => (
              <li key={v.id} className="flex flex-col gap-1 py-3">
                <p className="text-sm text-muted">
                  {v.role === 'before' ? t('evidence.before') : t('evidence.after')}
                </p>
                <p className="font-semibold">{v.label}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 text-sm">
                  <dt className="text-muted">{t('evidence.effective')}</dt>
                  <dd>{d(v.effectiveDate)}</dd>
                  <dt className="text-muted">{t('evidence.loaded')}</dt>
                  <dd>{f.dateTime(new Date(v.loadedAt), { dateStyle: 'medium' })}</dd>
                  <dt className="text-muted">{t('evidence.rows')}</dt>
                  <dd className="tabular-nums">{v.rowCount}</dd>
                  <dt className="text-muted">{t('evidence.dropped')}</dt>
                  <dd className="tabular-nums">{v.droppedCount}</dd>
                  <dt className="text-muted">{t('evidence.fingerprint')}</dt>
                  <dd className="font-mono text-xs break-all">{v.sha256}</dd>
                </dl>
                {/^https:\/\//.test(v.sourceUrl) && (
                  <a
                    href={v.sourceUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="inline-flex items-center gap-1 self-start text-sm font-semibold text-neel underline underline-offset-2"
                  >
                    {t('evidence.openSource')}
                    <ExternalLink aria-hidden className="size-4" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
