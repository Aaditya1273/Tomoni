'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@tomoni/ui';
import { api } from '@tomoni/web-shared';

export function MockPay({
  checkoutRef,
  success,
  cancel,
}: {
  checkoutRef: string;
  success: string;
  cancel: string;
}) {
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
            await api('/api/billing/mock/complete', { method: 'POST', body: { ref: checkoutRef } });
            window.location.assign(success);
          } catch {
            setFailed(true);
            setBusy(false);
          }
        }}
      >
        {t('mockPay')}
      </Button>
      <Button variant="quiet" onClick={() => window.location.assign(cancel)}>
        {t('mockCancel')}
      </Button>
      {failed && (
        <p role="alert" className="w-full text-act">
          {t('failed')}
        </p>
      )}
    </div>
  );
}
