'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@tomoni/ui';
import { api } from '@tomoni/web-shared';

/** Starts Blue Button: the API returns where to send the browser (Medicare.gov, or the mock). */
export function ConnectMedicare({
  patientId,
  name,
  sandbox,
}: {
  patientId: string;
  name: string;
  sandbox: boolean;
}) {
  const t = useTranslations('family');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted">{t('connectHelp', { name })}</p>
      <Button
        variant="secondary"
        className="self-start"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          try {
            const r = await api<{ authorizeUrl: string }>(`/api/patients/${patientId}/bluebutton/connect`, {
              method: 'POST',
            });
            window.location.assign(r.authorizeUrl);
          } catch {
            setFailed(true);
            setBusy(false);
          }
        }}
      >
        {busy ? t('connecting') : sandbox ? t('connectMedicareSandbox') : t('connectMedicare')}
      </Button>
      {failed && (
        <p role="alert" className="text-act">
          {t('connectFailed')}
        </p>
      )}
    </div>
  );
}
