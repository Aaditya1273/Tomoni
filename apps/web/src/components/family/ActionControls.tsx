'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import type { ActionItem } from '@tomoni/contracts';
import { Button } from '@tomoni/ui';
import { api } from '@tomoni/web-shared';
import { drugName } from '@/lib/medicines';

/** What Tomoni is doing about one warning, and the one tap the family may need to give. */
export function ActionControls({
  warningId,
  action,
  drug,
}: {
  warningId: string;
  action?: ActionItem;
  drug: string;
}) {
  const t = useTranslations('family.act');
  const f = useFormatter();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const go = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  const x = action?.facts ?? {};
  const toPharmacy = String(x.toPharmacy ?? '');
  const drugText = x.drug ? drugName(String(x.drug)) : drug;

  if (!action)
    return (
      <Button
        variant="secondary"
        className="self-start"
        disabled={busy}
        onClick={() => go(() => api(`/api/warnings/${warningId}/help`, { method: 'POST' }))}
      >
        {busy ? t('asking') : t('help')}
      </Button>
    );

  const decide = (decision: 'approve' | 'reject') =>
    go(() => api(`/api/actions/${action.id}/decision`, { method: 'POST', body: { decision } }));

  let text: string;
  switch (action.state) {
    case 'awaiting_approval':
      if (action.approvalClass === 'family')
        return (
          <div className="flex flex-col gap-2 rounded-panel bg-neel-soft p-3" data-action="needs-you">
            <p>{t(`ask.${action.skill as 'requestPharmacyTransfer'}`, { drug: drugText, toPharmacy })}</p>
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => decide('approve')}>
                {t('approve')}
              </Button>
              <Button variant="quiet" disabled={busy} onClick={() => decide('reject')}>
                {t('notNow')}
              </Button>
            </div>
          </div>
        );
      text = t('waitingDoctor');
      break;
    case 'succeeded':
      text =
        action.skill === 'checkRefillStatus'
          ? t(`done.checkRefillStatus.${(x.status ?? 'not_found') as 'ready'}`)
          : action.skill === 'comparePartDPlans'
            ? t('done.comparePartDPlans', {
                plan: String(x.bestPlan ?? ''),
                cost: f.number(Number(x.bestPlanYearlyCents ?? 0) / 100, {
                  style: 'currency',
                  currency: 'USD',
                  maximumFractionDigits: 0,
                }),
              })
            : t(`done.${action.skill as 'findStock'}`, { toPharmacy, found: Number(x.found ?? 0) });
      break;
    case 'rejected':
    case 'handoff':
    case 'failed':
      text = t(action.state);
      break;
    default:
      text = t('working');
  }
  return (
    <p className="text-sm font-semibold text-neel" data-action={action.state}>
      {text}
    </p>
  );
}
