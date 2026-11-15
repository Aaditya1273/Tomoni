'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DeskPatients, SimTurnResult } from '@tomoni/contracts';
import { Button, Notice } from '@tomoni/ui';
import { api, ApiError } from '@tomoni/web-shared';

type Line = { who: 'tomoni' | 'caller'; text: string };

/** Talk to the call engine as the patient (BUILD_PROMPT §5.4 "call simulator"). Nothing is dialed. */
export function Simulator({ patients }: { patients: DeskPatients }) {
  const t = useTranslations('desk');
  const [patientId, setPatientId] = useState(patients[0]?.id ?? '');
  const [callId, setCallId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState<{ tone: 'act' | 'info'; text: string }[]>([]);
  const [ended, setEnded] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (r: SimTurnResult) => {
    setLines((l) => [...l, ...r.say.map((s) => ({ who: 'tomoni' as const, text: s }))]);
    setNotes((n) => [
      ...n,
      ...r.flags.map((f) => ({
        tone: 'act' as const,
        text: t('simFlagged', { class: t(`class.${f.class}`) }),
      })),
      ...(r.ended
        ? [
            {
              tone: 'info' as const,
              text: t('simEnded', { outcome: t(`simOutcome.${r.outcome ?? 'completed'}`) }),
            },
          ]
        : []),
    ]);
    setEnded(r.ended);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof ApiError && e.body.error === 'no_contact_consent' ? t('simNoConsent') : t('simError'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-[48rem] flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sim-patient" className="font-semibold">
            {t('simPatient')}
          </label>
          <select
            id="sim-patient"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            className="min-h-target rounded-control border border-line-strong bg-surface px-2"
          >
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.locale})
              </option>
            ))}
          </select>
        </div>
        <Button
          disabled={!patientId || busy}
          onClick={() =>
            run(async () => {
              const r = await api<SimTurnResult>('/api/sim/calls', { method: 'POST', body: { patientId } });
              setCallId(r.callId);
              setLines([]);
              setNotes([]);
              apply(r);
            })
          }
        >
          {t('simStart')}
        </Button>
      </div>

      {error && <Notice tone="watch">{error}</Notice>}

      {callId && (
        <>
          <ol
            aria-label="Transcript"
            aria-live="polite"
            className="flex flex-col gap-2 rounded-panel bg-surface p-4"
          >
            {lines.map((l, i) => (
              <li key={i} className={l.who === 'caller' ? 'self-end text-right' : ''} data-who={l.who}>
                <span className="block text-sm text-muted">
                  {l.who === 'caller' ? t('simYou') : t('simTomoni')}
                </span>
                {l.text}
              </li>
            ))}
          </ol>
          {notes.map((n, i) => (
            <Notice key={i} tone={n.tone}>
              {n.text}
            </Notice>
          ))}
          {!ended && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const said = text.trim();
                if (!said) return;
                setText('');
                setLines((l) => [...l, { who: 'caller', text: said }]);
                void run(async () =>
                  apply(
                    await api<SimTurnResult>(`/api/sim/calls/${callId}/turn`, {
                      method: 'POST',
                      body: { text: said },
                    }),
                  ),
                );
              }}
            >
              <label htmlFor="sim-reply" className="sr-only">
                {t('simReply')}
              </label>
              <input
                id="sim-reply"
                autoFocus
                value={text}
                maxLength={1000}
                placeholder={t('simReply')}
                onChange={(e) => setText(e.target.value)}
                className="min-h-target flex-1 rounded-control border border-line-strong bg-surface px-3"
              />
              <Button type="submit" disabled={busy}>
                {t('simSend')}
              </Button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
