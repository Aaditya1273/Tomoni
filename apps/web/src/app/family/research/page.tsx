import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import type { ResearchOverview } from '@tomoni/contracts';
import { Notice } from '@tomoni/ui';
import { apiGet, requireSurface } from '@tomoni/web-shared/server';
import { Decide } from '@/components/desk/Decide';
import { ConsentForm } from './ConsentForm';

export const metadata = { title: 'Research studies' };

/** The research registry consent (rule 2.5): separate from care, opt-in per use, withdrawable here. */
export default async function Research() {
  await requireSurface('family');
  const [t, f, res] = await Promise.all([
    getTranslations('family.research'),
    getFormatter(),
    apiGet<ResearchOverview>('/api/research'),
  ]);
  const ov = res.data;
  const day = (iso: string) =>
    f.dateTime(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso), { dateStyle: 'medium' });
  return (
    <main id="main" className="flex flex-1 flex-col gap-6 pt-8">
      <Link href="/family" className="inline-flex items-center gap-2 self-start font-semibold text-neel">
        <ArrowLeft aria-hidden className="size-5" />
        {(await getTranslations('family'))('evidence.back')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <Notice tone="info">{t('separate')}</Notice>
      {!ov?.protocol ? (
        <p className="text-muted">{t('none')}</p>
      ) : (
        <>
          <section aria-labelledby="proto-h" className="flex flex-col gap-2">
            <h2 id="proto-h" className="text-xl font-semibold">
              {ov.protocol.title}
            </h2>
            <p className="text-pretty">{ov.protocol.summary}</p>
            <p className="text-sm text-muted">
              {t('irb', {
                irb: ov.protocol.irbName,
                ref: ov.protocol.irbApprovalRef ?? '',
                date: ov.protocol.expiresAt ? day(ov.protocol.expiresAt) : '',
              })}
            </p>
          </section>
          {ov.people.map((p) => (
            <section
              key={p.patientId}
              className="flex flex-col gap-3 border-t border-line pt-4"
              data-research={p.consent ? 'joined' : 'open'}
            >
              <h2 className="text-xl font-semibold">{p.name}</h2>
              {p.consent ? (
                <>
                  <p>{t('joined', { name: p.name, date: day(p.consent.givenAt) })}</p>
                  <p className="font-semibold">{t('uses')}</p>
                  <ul className="list-disc pl-5">
                    {(['trialMatching', 'speechTask', 'pgxResearch'] as const)
                      .filter((k) => p.consent!.scopes[k])
                      .map((k) => (
                        <li key={k}>{t(`use.${k}`)}</li>
                      ))}
                    {p.consent.recordingPermission && <li>{t('recording')}</li>}
                  </ul>
                  <Decide
                    options={[
                      {
                        label: t('withdraw'),
                        path: `/api/research/consents/${p.consent.id}/withdraw`,
                        quiet: true,
                      },
                    ]}
                  />
                </>
              ) : p.canConsentAs ? (
                <ConsentForm
                  patientId={p.patientId}
                  protocolId={ov.protocol!.id}
                  name={p.name}
                  asRep={p.canConsentAs === 'representative'}
                />
              ) : (
                <p className="text-muted">{t('cannot', { name: p.name })}</p>
              )}
            </section>
          ))}
        </>
      )}
    </main>
  );
}
