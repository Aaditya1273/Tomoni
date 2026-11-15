'use client';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { Feasibility } from '@tomoni/contracts';
import { Button, Notice } from '@tomoni/ui';
import { api, ApiError } from '@tomoni/web-shared';

const CONDITIONS = [
  'heart_failure',
  'coronary_artery_disease',
  'atrial_fibrillation',
  'diabetes',
  'copd',
  'ckd',
  'dementia',
  'depression',
];
const LANGS = ['en', 'hi', 'gu', 'ta', 'pa', 'bn'];

export function FeasibilityForm() {
  const t = useTranslations('sponsor');
  const f = useFormatter();
  const [res, setRes] = useState<Feasibility | null>(null);
  const [error, setError] = useState<string | null>(null);
  const num = (n: number | null) => (n === null ? t('hidden') : f.number(n));
  return (
    <form
      method="post"
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const days = Number(fd.get('days'));
        setError(null);
        try {
          setRes(
            await api<Feasibility>('/sponsor-api/feasibility', {
              method: 'POST',
              body: {
                conditions: fd.getAll('conditions').map(String),
                languages: fd.getAll('languages').map(String),
                ...(days ? { inpatient_within_days: days } : {}),
              },
            }),
          );
        } catch (err) {
          setError(err instanceof ApiError ? err.message : String(err));
        }
      }}
    >
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
        <legend className="mb-1 font-semibold">{t('conditions')}</legend>
        {CONDITIONS.map((c) => (
          <label key={c} className="flex min-h-target items-center gap-2 pr-2 text-sm">
            <input type="checkbox" name="conditions" value={c} className="size-5" />
            {c.replaceAll('_', ' ')}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
        <legend className="mb-1 font-semibold">{t('languages')}</legend>
        {LANGS.map((l) => (
          <label key={l} className="flex min-h-target items-center gap-2 pr-2 text-sm">
            <input type="checkbox" name="languages" value={l} className="size-5" />
            {l}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor="days" className="font-semibold">
          {t('inpatient')}
        </label>
        <select
          id="days"
          name="days"
          className="min-h-target max-w-[16rem] rounded-control border border-line-strong bg-surface px-2"
        >
          <option value="0">{t('anyTime')}</option>
          {[90, 180, 365, 730].map((d) => (
            <option key={d} value={d}>
              {t('days', { n: d })}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" className="self-start">
        {t('count')}
      </Button>
      {error && <Notice tone="act">{error}</Notice>}
      {res && (
        <dl
          className="grid max-w-[24rem] grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm tabular-nums"
          data-feasibility
        >
          <dt className="font-semibold">{t('total')}</dt>
          <dd className="text-right font-semibold" data-total>
            {num(res.total)}
          </dd>
          {res.byAgeBand.map((b) => (
            <div key={b.band} className="contents">
              <dt>{b.band}</dt>
              <dd className="text-right">{num(b.n)}</dd>
            </div>
          ))}
        </dl>
      )}
    </form>
  );
}
