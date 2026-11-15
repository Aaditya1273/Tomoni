'use client';
import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { NurseFlagItem } from '@tomoni/contracts';
import { Button, StatusPill } from '@tomoni/ui';
import { api } from '@tomoni/web-shared';

/**
 * Nurse flags, live (BUILD_PROMPT §6: on the desk within 5 seconds of the call event). The event
 * stream only says "something changed"; the list is refetched through the RLS-scoped API.
 */
export function FlagQueue({ initial }: { initial: NurseFlagItem[] }) {
  const t = useTranslations('desk');
  const f = useFormatter();
  const [flags, setFlags] = useState(initial);
  const [live, setLive] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    setFlags(await api<NurseFlagItem[]>('/api/desk/flags'));
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    const onFlag = async () => {
      const next = await api<NurseFlagItem[]>('/api/desk/flags');
      setFlags((prev) => {
        const fresh = next.find((n) => !prev.some((p) => p.id === n.id));
        if (fresh) setAnnounce(t('flagNew', { class: t(`class.${fresh.class}`), name: fresh.patientName }));
        return next;
      });
    };
    for (const topic of ['flag.created', 'flag.acknowledged', 'flag.resolved'])
      es.addEventListener(topic, onFlag);
    return () => es.close();
  }, [t]);

  return (
    <section aria-labelledby="flags-h" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="flags-h" className="text-lg font-semibold">
          {t('flagsTitle')}
        </h2>
        <span className="text-sm text-muted" data-live={live}>
          {live ? t('flagsLive') : t('flagsOffline')}
        </span>
      </div>
      <p className="sr-only" role="status" aria-live="assertive">
        {announce}
      </p>
      {flags.length === 0 ? (
        <p className="text-muted">{t('queueEmptyBody')}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {flags.map((x) => (
            <li key={x.id} className="flex flex-col gap-1.5 py-3" data-flag={x.class}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={x.urgency === 1 ? 'act' : 'watch'}>{t(`class.${x.class}`)}</StatusPill>
                <span className="font-semibold">{x.patientName}</span>
                <span className="text-sm text-muted">
                  {t('via', {
                    channel: t(`channel.${x.channel as 'simulator'}`),
                    time: f.relativeTime(new Date(x.createdAt)),
                  })}
                </span>
              </div>
              <blockquote className="border-l-2 border-line-strong pl-3">“{x.excerpt}”</blockquote>
              {resolving === x.id ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await api(`/api/desk/flags/${x.id}/resolve`, { method: 'POST', body: { note } });
                    setResolving(null);
                    setNote('');
                    await refresh();
                  }}
                >
                  <label htmlFor={`note-${x.id}`} className="text-sm font-semibold">
                    {t('resolveNote')}
                  </label>
                  <textarea
                    id={`note-${x.id}`}
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
                  {x.status === 'open' ? (
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        await api(`/api/desk/flags/${x.id}/acknowledge`, { method: 'POST' });
                        await refresh();
                      }}
                    >
                      {t('acknowledge')}
                    </Button>
                  ) : (
                    <span className="self-center text-sm text-muted">{t('acknowledged')}</span>
                  )}
                  <Button variant="quiet" onClick={() => setResolving(x.id)}>
                    {t('resolve')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
