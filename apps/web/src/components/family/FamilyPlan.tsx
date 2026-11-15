'use client';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { BillingStatus } from '@tomoni/contracts';
import { Button, StatusPill } from '@tomoni/ui';
import { api } from '@tomoni/web-shared';

/** India bridge (D-030): the family abroad pays for the parent's daily call. */
export function FamilyPlan({ plan, name, sandbox }: { plan: BillingStatus; name: string; sandbox: boolean }) {
  const t = useTranslations('family.plan');
  const f = useFormatter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const price = f.number(plan.price.cents / 100, { style: 'currency', currency: plan.price.currency });
  const on = plan.status === 'active' || plan.status === 'past_due';
  return (
    <div className="flex flex-col gap-2 rounded-panel bg-surface p-4" data-plan-status={plan.status}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{t('title', { name })}</h3>
        {on && <StatusPill status={plan.status === 'active' ? 'ok' : 'watch'}>{t(plan.status)}</StatusPill>}
      </div>
      {plan.status === 'active' ? (
        <p>
          {plan.periodEnd
            ? t('activeUntil', { date: f.dateTime(new Date(plan.periodEnd), { dateStyle: 'medium' }), price })
            : t('activeBody', { price })}
        </p>
      ) : plan.status === 'past_due' ? (
        <p>{t('pastDueBody', { name })}</p>
      ) : (
        <>
          <p>{t('offer', { name, price })}</p>
          <Button
            className="self-start"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setFailed(false);
              try {
                const r = await api<{ url: string }>('/api/family/billing/checkout', {
                  method: 'POST',
                  body: { householdId: plan.householdId },
                });
                window.location.assign(r.url);
              } catch {
                setFailed(true);
                setBusy(false);
              }
            }}
          >
            {busy ? t('opening') : sandbox ? t('startSandbox') : t('start')}
          </Button>
          {failed && (
            <p role="alert" className="text-act">
              {t('failed')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
