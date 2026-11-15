'use client';
import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { CarePlanItem, DeskPatient, QueueItem, WarningEvidence } from '@tomoni/contracts';
import { Button, StatusPill } from '@tomoni/ui';
import { api } from '@tomoni/web-shared';
import { drugName } from '@/lib/medicines';

/**
 * The doctor desk queue (BUILD_PROMPT §5.6): flags, renewals and care plans in one list, most
 * urgent first, with the evidence beside it. Keyboard first: j/k move, s signs or acknowledges,
 * x selects, Shift+S signs every selected item. Live: any change refetches the list.
 */
export function DeskQueue({ initial, canSign }: { initial: QueueItem[]; canSign: boolean }) {
  const t = useTranslations('desk');
  const f = useFormatter();
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [live, setLive] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const current = items[Math.min(cursor, items.length - 1)];

  const refresh = useCallback(async () => {
    const next = await api<QueueItem[]>('/api/desk/queue');
    setItems((prev) => {
      const fresh = next.find((n) => n.kind === 'flag' && !prev.some((p) => p.id === n.id));
      if (fresh)
        setAnnounce(t('flagNew', { class: t(`class.${fresh.flagClass!}`), name: fresh.patientName }));
      return next;
    });
  }, [t]);

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    const on = () => void refresh();
    for (const topic of ['flag.created', 'flag.acknowledged', 'flag.resolved', 'action.proposed'])
      es.addEventListener(topic, on);
    return () => es.close();
  }, [refresh]);

  const signable = (i: QueueItem) => canSign && (i.kind === 'approval' || i.kind === 'care_plan');
  const primary = useCallback(
    async (i: QueueItem) => {
      if (i.kind === 'flag') {
        if (i.flagStatus === 'open') await api(`/api/desk/flags/${i.id}/acknowledge`, { method: 'POST' });
      } else if (i.kind === 'approval' && canSign)
        await api(`/api/actions/${i.id}/decision`, { method: 'POST', body: { decision: 'approve' } });
      else if (i.kind === 'care_plan' && canSign)
        await api(`/api/desk/care-plans/${i.id}/sign`, { method: 'POST' });
      await refresh();
    },
    [canSign, refresh],
  );

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
      if (typing || e.metaKey || e.ctrlKey || e.altKey || !items.length) return;
      if (e.key === 'j' || e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, items.length - 1));
      else if (e.key === 'k' || e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0));
      else if (e.key === 'x' && current)
        setPicked((p) => {
          const n = new Set(p);
          if (n.has(current.id)) n.delete(current.id);
          else n.add(current.id);
          return n;
        });
      else if (e.key === 's' && current) await primary(current);
      else if (e.key === 'S') {
        for (const i of items.filter((x) => picked.has(x.id) && signable(x))) await primary(i);
        setPicked(new Set());
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const title = (i: QueueItem) =>
    i.kind === 'flag'
      ? t(`class.${i.flagClass!}`)
      : i.kind === 'approval'
        ? t(`what.${i.skill as 'draftRenewalForDoctor'}`, { drug: i.drug ? drugName(i.drug) : '' })
        : i.kind === 'gene_drug'
          ? t('geneDrug', {
              drug: i.drug ? drugName(i.drug) : '',
              gene: i.gene ?? '',
              phenotype: i.phenotype ?? '',
            })
          : t('planToSign', { v: i.version ?? 1 });
  const pickedSignable = items.filter((x) => picked.has(x.id) && signable(x)).length;

  return (
    <div className="grid flex-1 lg:grid-cols-[26rem_1fr]">
      <section aria-labelledby="queue-h" className="border-line p-4 lg:border-r">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h1 id="queue-h" className="text-lg font-semibold">
            {t('queueTitle')}
          </h1>
          <span className="text-sm text-muted" data-live={live}>
            {live ? t('flagsLive') : t('flagsOffline')}
          </span>
        </div>
        <p className="sr-only" role="status" aria-live="assertive">
          {announce}
        </p>
        {pickedSignable > 0 && (
          <p className="mb-2 text-sm font-semibold" role="status">
            {t('selected', { n: pickedSignable })}
          </p>
        )}
        {items.length === 0 ? (
          <p className="text-muted">{t('queueEmptyBody')}</p>
        ) : (
          <ol className="flex flex-col divide-y divide-line" aria-label={t('queueTitle')}>
            {items.map((i, n) => (
              <li
                key={i.id}
                aria-current={n === cursor ? 'true' : undefined}
                onClick={() => setCursor(n)}
                className={`flex flex-col gap-1.5 py-3 pl-2 ${n === cursor ? 'border-l-4 border-neel bg-neel-soft' : 'border-l-4 border-transparent'}`}
                {...{
                  [`data-${i.kind === 'care_plan' ? 'plan' : i.kind}`]:
                    i.kind === 'flag'
                      ? i.flagClass
                      : i.kind === 'approval'
                        ? i.skill
                        : i.kind === 'gene_drug'
                          ? i.gene
                          : 'draft',
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {picked.has(i.id) && <span className="text-sm font-semibold text-neel">✓</span>}
                  <StatusPill status={i.urgency === 1 ? 'act' : 'watch'}>{title(i)}</StatusPill>
                  <a
                    href={`/desk/patients/${i.patientId}`}
                    className="font-semibold text-neel underline underline-offset-2"
                  >
                    {i.patientName}
                  </a>
                  <span className="text-sm text-muted">{f.relativeTime(new Date(i.createdAt))}</span>
                </div>
                {i.kind === 'flag' && (
                  <blockquote className="border-l-2 border-line-strong pl-3">“{i.excerpt}”</blockquote>
                )}
                {i.kind === 'flag' && resolving === i.id ? (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await api(`/api/desk/flags/${i.id}/resolve`, { method: 'POST', body: { note } });
                      setResolving(null);
                      setNote('');
                      await refresh();
                    }}
                  >
                    <label htmlFor={`note-${i.id}`} className="text-sm font-semibold">
                      {t('resolveNote')}
                    </label>
                    <textarea
                      id={`note-${i.id}`}
                      required
                      maxLength={1000}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="min-h-20 rounded-control border border-line-strong bg-surface p-2"
                    />
                    <div className="flex gap-2">
                      <Button type="submit">{t('resolveSave')}</Button>
                      <Button type="button" variant="quiet" onClick={() => setResolving(null)}>
                        {t('cancel')}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex gap-2">
                    {i.kind === 'flag' &&
                      (i.flagStatus === 'open' ? (
                        <Button variant="secondary" onClick={() => primary(i)}>
                          {t('acknowledge')}
                        </Button>
                      ) : (
                        <span className="self-center text-sm text-muted">{t('acknowledged')}</span>
                      ))}
                    {i.kind === 'flag' && (
                      <Button variant="quiet" onClick={() => setResolving(i.id)}>
                        {t('resolve')}
                      </Button>
                    )}
                    {signable(i) && (
                      <Button variant="secondary" onClick={() => primary(i)}>
                        {t('sign')}
                      </Button>
                    )}
                    {canSign && i.kind === 'approval' && (
                      <Button
                        variant="quiet"
                        onClick={async () => {
                          await api(`/api/actions/${i.id}/decision`, {
                            method: 'POST',
                            body: { decision: 'reject' },
                          });
                          await refresh();
                        }}
                      >
                        {t('decline')}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
      <section aria-label={t('evidence')} className="hidden bg-sunken p-6 lg:block">
        {current ? <Evidence item={current} /> : <p className="text-center text-muted">{t('detailEmpty')}</p>}
      </section>
    </div>
  );
}

/** What the signer needs to decide, without looking anything up. */
function Evidence({ item }: { item: QueueItem }) {
  const t = useTranslations('desk');
  const f = useFormatter();
  const [ev, setEv] = useState<WarningEvidence | null>(null);
  const [plan, setPlan] = useState<CarePlanItem | null>(null);
  useEffect(() => {
    setEv(null);
    setPlan(null);
    if (item.kind === 'approval' && item.warningId)
      void api<WarningEvidence>(`/api/warnings/${item.warningId}`).then(setEv);
    if (item.kind === 'care_plan')
      void api<DeskPatient>(`/api/desk/patients/${item.patientId}`).then((p) =>
        setPlan(p.carePlans.find((c) => c.id === item.id) ?? null),
      );
  }, [item.id, item.kind, item.warningId, item.patientId]);

  return (
    <div className="flex max-w-[40rem] flex-col gap-3" data-evidence={item.kind}>
      <h2 className="text-lg font-semibold">{item.patientName}</h2>
      {item.kind === 'flag' && (
        <>
          <p className="text-muted">
            {t('evidenceFlag', { channel: t(`channel.${(item.channel ?? 'voice') as 'voice'}`) })}
          </p>
          <blockquote className="border-l-4 border-act pl-3 text-lg">“{item.excerpt}”</blockquote>
        </>
      )}
      {item.kind === 'approval' &&
        (ev ? (
          <>
            <p>{t('evidenceRenewal', { drug: drugName(ev.fills[0]?.drug ?? item.drug ?? '') })}</p>
            <ul className="flex flex-col divide-y divide-line rounded-panel bg-surface px-4 text-sm">
              {ev.fills.map((x) => (
                <li key={x.id} className="py-2">
                  {f.dateTime(new Date(`${x.fillDate}T12:00:00Z`), { dateStyle: 'medium' })} · {x.daysSupply}{' '}
                  {t('days')} · {x.pharmacy ?? '—'}
                </li>
              ))}
            </ul>
            {ev.warning.facts.refillsRemaining === 0 && (
              <p className="text-sm text-muted">{t('noRefillsLeft')}</p>
            )}
          </>
        ) : (
          <p className="text-muted">…</p>
        ))}
      {item.kind === 'gene_drug' && (
        <>
          <p>
            {t('geneEvidence', {
              gene: item.gene ?? '',
              phenotype: item.phenotype ?? '',
              drug: item.drug ? drugName(item.drug) : '',
            })}
          </p>
          {item.guideline?.startsWith('https://cpicpgx.org/') && (
            <a
              href={item.guideline}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-neel underline underline-offset-2"
            >
              {t('guideline')}
            </a>
          )}
        </>
      )}
      {item.kind === 'care_plan' &&
        (plan ? (
          <ul className="list-disc pl-5 text-sm">
            {plan.body.problems.map((p) => (
              <li key={p.code}>{p.name}</li>
            ))}
            {plan.body.medications.map((m) => (
              <li key={m}>{drugName(m)}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">…</p>
        ))}
    </div>
  );
}
