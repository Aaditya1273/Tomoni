'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { CarePlanItem } from '@tomoni/contracts';
import { Button } from '@tomoni/ui';
import { api } from '@tomoni/web-shared';

/** Edit a draft's goals and interventions, one per line. Saving bumps its revision. */
export function CarePlanEditor({ plan }: { plan: CarePlanItem }) {
  const t = useTranslations('desk.patient');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [goals, setGoals] = useState(plan.body.goals.join('\n'));
  const [interventions, setInterventions] = useState(plan.body.interventions.join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = (s: string) =>
    s
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  if (!open)
    return (
      <Button variant="quiet" className="self-start" onClick={() => setOpen(true)}>
        {t('edit')}
      </Button>
    );
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api(`/api/desk/care-plans/${plan.id}`, {
            method: 'PUT',
            body: { revision: plan.revision, goals: lines(goals), interventions: lines(interventions) },
          });
          setOpen(false);
          router.refresh();
        } catch (err) {
          setError((err as { status?: number }).status === 409 ? t('changed') : t('saveFailed'));
        } finally {
          setBusy(false);
        }
      }}
    >
      {(
        [
          ['goals', goals, setGoals],
          ['interventions', interventions, setInterventions],
        ] as const
      ).map(([k, v, set]) => (
        <div key={k} className="flex flex-col gap-1">
          <label htmlFor={`plan-${k}`} className="text-sm font-semibold">
            {t(k)}
          </label>
          <p id={`plan-${k}-hint`} className="text-sm text-muted">
            {t('onePerLine')}
          </p>
          <textarea
            id={`plan-${k}`}
            aria-describedby={`plan-${k}-hint`}
            rows={4}
            value={v}
            maxLength={6000}
            onChange={(e) => set(e.target.value)}
            className="rounded-control border border-line-strong bg-surface p-2 text-sm"
          />
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-act">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {t('save')}
        </Button>
        <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
