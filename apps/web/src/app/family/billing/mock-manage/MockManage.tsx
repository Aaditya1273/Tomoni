'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@tomoni/ui';
import { api } from '@tomoni/web-shared';

export function MockManage({ householdId, ending }: { householdId: string; ending: boolean }) {
  const t = useTranslations('family.plan');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api('/api/billing/mock/cancel', { method: 'POST', body: { householdId, cancel: !ending } });
            window.location.assign('/family');
          } catch {
            setFailed(true);
            setBusy(false);
          }
        }}
      >
        {ending ? t('mockResume') : t('mockCancelPlan')}
      </Button>
      <Button variant="quiet" onClick={() => window.location.assign('/family')}>
        {t('mockBack')}
      </Button>
      {failed && (
        <p role="alert" className="w-full text-act">
          {t('failed')}
        </p>
      )}
    </div>
  );
}
