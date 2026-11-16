'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { TrialDraft, TrialSetupOptions } from '@tomoni/contracts';
import { Button, TextField } from '@tomoni/ui';
import { api, ApiError } from '@tomoni/web-shared';

const LANGS = ['hi', 'gu', 'pa', 'ta', 'bn', 'en'] as const;
type Q = { en: string; hi: string; eligibleAnswer: 'yes' | 'no'; approvalRef: string };
const blank = (): Q => ({ en: '', hi: '', eligibleAnswer: 'yes', approvalRef: '' });

/** A new study as a draft: nobody is matched to it until the coordinator starts recruiting. */
export function TrialForm({ options }: { options: TrialSetupOptions }) {
  const t = useTranslations('admin.research.trials');
  const router = useRouter();
  const [sponsorId, setSponsor] = useState(options.sponsors[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [area, setArea] = useState('');
  const [nct, setNct] = useState('');
  const [minAge, setMinAge] = useState('65');
  const [conditions, setConditions] = useState<string[]>([]);
  const [langs, setLangs] = useState<string[]>([]);
  const [qs, setQs] = useState<Q[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const criteria: TrialDraft['criteria'] = [
          ...(minAge ? [{ field: 'age_band_min' as const, value: Number(minAge) }] : []),
          ...(conditions.length ? [{ field: 'condition_any' as const, value: conditions }] : []),
          ...(langs.length ? [{ field: 'language_any' as const, value: langs as never }] : []),
        ];
        try {
          await api('/api/research/trials', {
            method: 'POST',
            body: {
              sponsorId,
              title,
              therapeuticArea: area,
              nctId: nct.trim() || null,
              criteria,
              questions: qs.map((q) => ({
                wording: { en: q.en, ...(q.hi.trim() ? { hi: q.hi } : {}) },
                eligibleAnswer: q.eligibleAnswer,
                approvalRef: q.approvalRef,
              })),
            } satisfies TrialDraft,
          });
          router.refresh();
          setTitle('');
          setQs([]);
        } catch (err) {
          setError(err instanceof ApiError && err.status !== 400 ? err.message : t('invalid'));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="sponsor" className="font-semibold">
          {t('sponsor')}
        </label>
        <select
          id="sponsor"
          value={sponsorId}
          onChange={(e) => setSponsor(e.target.value)}
          className="min-h-target rounded-control border border-line-strong bg-surface px-3"
        >
          {options.sponsors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <TextField label={t('studyTitle')} value={title} onChange={(e) => setTitle(e.target.value)} required />
      <TextField label={t('area')} value={area} onChange={(e) => setArea(e.target.value)} required />
      <TextField label={t('nct')} hint={t('nctHint')} value={nct} onChange={(e) => setNct(e.target.value)} />
      <TextField
        label={t('minAge')}
        type="number"
        min={18}
        max={110}
        value={minAge}
        onChange={(e) => setMinAge(e.target.value)}
      />
      <fieldset className="flex flex-col gap-1">
        <legend className="font-semibold">{t('conditions')}</legend>
        <div className="grid grid-cols-2 gap-1 text-sm">
          {options.conditions.map((c) => (
            <label key={c.code} className="flex min-h-target items-center gap-2">
              <input
                type="checkbox"
                checked={conditions.includes(c.code)}
                onChange={() => setConditions(toggle(conditions, c.code))}
              />
              {c.name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="font-semibold">{t('languages')}</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {LANGS.map((l) => (
            <label key={l} className="flex min-h-target items-center gap-2">
              <input
                type="checkbox"
                checked={langs.includes(l)}
                onChange={() => setLangs(toggle(langs, l))}
              />
              {l}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="font-semibold">{t('questions')}</legend>
        <p className="text-sm text-muted">{t('questionsHint')}</p>
        {qs.map((q, i) => {
          const set = (patch: Partial<Q>) => setQs(qs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} className="flex flex-col gap-2 rounded-panel bg-surface p-3" data-question={i + 1}>
              <TextField
                label={t('qEn', { n: i + 1 })}
                value={q.en}
                onChange={(e) => set({ en: e.target.value })}
                required
              />
              <TextField
                label={t('qHi', { n: i + 1 })}
                value={q.hi}
                onChange={(e) => set({ hi: e.target.value })}
              />
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`elig-${i}`} className="font-semibold">
                  {t('eligible', { n: i + 1 })}
                </label>
                <select
                  id={`elig-${i}`}
                  value={q.eligibleAnswer}
                  onChange={(e) => set({ eligibleAnswer: e.target.value as 'yes' | 'no' })}
                  className="min-h-target rounded-control border border-line-strong bg-surface px-3"
                >
                  <option value="yes">{t('yes')}</option>
                  <option value="no">{t('no')}</option>
                </select>
              </div>
              <TextField
                label={t('approval', { n: i + 1 })}
                value={q.approvalRef}
                onChange={(e) => set({ approvalRef: e.target.value })}
                required
              />
            </div>
          );
        })}
        {qs.length < 5 && (
          <Button
            type="button"
            variant="quiet"
            className="self-start"
            onClick={() => setQs([...qs, blank()])}
          >
            {t('addQuestion')}
          </Button>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-act">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || !sponsorId} className="self-start">
        {t('create')}
      </Button>
    </form>
  );
}
