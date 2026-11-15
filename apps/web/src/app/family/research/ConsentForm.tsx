'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Notice, TextField } from '@tomoni/ui';
import { api, ApiError } from '@tomoni/web-shared';

/** Each use is its own opt-in, unticked by default; the typed name is the e-signature. */
export function ConsentForm({
  patientId,
  protocolId,
  name,
  asRep,
}: {
  patientId: string;
  protocolId: string;
  name: string;
  asRep: boolean;
}) {
  const t = useTranslations('family.research');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      method="post"
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        try {
          await api('/api/research/consents', {
            method: 'POST',
            body: {
              patientId,
              protocolId,
              scopes: {
                trialMatching: fd.has('trialMatching'),
                speechTask: fd.has('speechTask'),
                pgxResearch: fd.has('pgxResearch'),
              },
              recordingPermission: fd.has('recording'),
              signature: String(fd.get('signature') ?? ''),
            },
          });
          router.refresh();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : String(err));
        }
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">{t('choose', { name })}</legend>
        {(['trialMatching', 'speechTask', 'pgxResearch'] as const).map((k) => (
          <label key={k} className="flex min-h-target items-center gap-3">
            <input type="checkbox" name={k} />
            {t(`use.${k}`)}
          </label>
        ))}
        <label className="flex min-h-target items-center gap-3">
          <input type="checkbox" name="recording" />
          {t('recording')}
        </label>
      </fieldset>
      {asRep && <Notice tone="info">{t('asRep', { name })}</Notice>}
      <TextField
        name="signature"
        label={t('signature')}
        required
        minLength={2}
        maxLength={120}
        autoComplete="name"
      />
      <Button type="submit" className="self-start">
        {t('agree')}
      </Button>
      {error && <Notice tone="act">{error}</Notice>}
    </form>
  );
}
