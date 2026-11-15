'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Notice, TextField } from '@tomoni/ui';
import { api, ApiError } from '@tomoni/web-shared';

const GENES = ['CYP2C19', 'SLCO1B1', 'CYP2C9', 'VKORC1', 'CYP2D6'];
const PHENOTYPES = [
  'Poor Metabolizer',
  'Intermediate Metabolizer',
  'Normal Metabolizer',
  'Rapid Metabolizer',
  'Ultrarapid Metabolizer',
  'Poor Function',
  'Decreased Function',
  'Normal Function',
];

/** Gene-to-Pill: the physician enters a lab's PGx result; every prescription is then checked against it. */
export function PgxForm({ patientId, today }: { patientId: string; today: string }) {
  const t = useTranslations('desk.pgx');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'act'; text: string } | null>(null);
  const select = (name: string, label: string, options: string[]) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`pgx-${name}`} className="text-sm font-semibold">
        {label}
      </label>
      <select
        id={`pgx-${name}`}
        name={name}
        className="min-h-target rounded-control border border-line-strong bg-surface px-2"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
  );
  return (
    <form
      method="post"
      className="flex flex-col gap-3 rounded-panel bg-surface p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        try {
          await api(`/api/desk/patients/${patientId}/pgx`, {
            method: 'POST',
            body: {
              gene: fd.get('gene'),
              diplotype: fd.get('diplotype'),
              phenotype: fd.get('phenotype'),
              lab: fd.get('lab'),
              reportedAt: fd.get('reportedAt'),
            },
          });
          setMsg({ tone: 'ok', text: t('saved') });
        } catch (err) {
          setMsg({ tone: 'act', text: err instanceof ApiError ? err.message : String(err) });
        }
      }}
    >
      <h3 className="font-semibold">{t('title')}</h3>
      <p className="text-sm text-muted">{t('help')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {select('gene', t('gene'), GENES)}
        <TextField name="diplotype" label={t('diplotype')} required placeholder="*2/*2" maxLength={30} />
        {select('phenotype', t('phenotype'), PHENOTYPES)}
        <TextField name="lab" label={t('lab')} required minLength={2} maxLength={120} />
        <TextField
          name="reportedAt"
          label={t('reported')}
          type="date"
          required
          max={today}
          defaultValue={today}
        />
      </div>
      <Button type="submit" variant="secondary" className="self-start">
        {t('save')}
      </Button>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </form>
  );
}
