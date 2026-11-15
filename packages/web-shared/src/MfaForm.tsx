'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { Button, Notice, TextField } from '@tomoni/ui';
import { api, ApiError } from './api';

export function MfaForm({ mode }: { mode: 'verify' | 'enroll' }) {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const router = useRouter();
  const [enroll, setEnroll] = useState<{ qr: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== 'enroll') return;
    api<{ otpauthUri: string; secret: string }>('/api/auth/mfa/enroll', { method: 'POST' })
      .then(async (r) =>
        setEnroll({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauthUri, { margin: 1, width: 220 }) }),
      )
      .catch(() => setError(tc('errorGeneric')));
  }, [mode, tc]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code')).replace(/\s/g, '');
    setBusy(true);
    setError(null);
    try {
      await api(mode === 'enroll' ? '/api/auth/mfa/enroll/confirm' : '/api/auth/mfa/verify', {
        method: 'POST',
        body: { code },
      });
      router.replace('/');
      router.refresh();
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof ApiError && (err.status === 401 || err.status === 400)
          ? t('badCode')
          : tc('errorGeneric'),
      );
    }
  }

  return (
    <form method="post" onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {error && <Notice tone="act" title={error} />}
      {mode === 'enroll' && enroll && (
        <div className="flex flex-col gap-3">
          {/* data: URL image, not injected markup (SECURITY S10) */}
          <img
            src={enroll.qr}
            alt=""
            width={220}
            height={220}
            className="rounded-control border border-line bg-white p-2"
          />
          <p className="text-sm text-muted">{t('mfaManual')}</p>
          <code className="w-fit select-all rounded-control bg-sunken px-3 py-2 text-sm tracking-wider break-all">
            {enroll.secret.match(/.{1,4}/g)?.join(' ')}
          </code>
        </div>
      )}
      <TextField
        label={t('code')}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
      />
      <Button type="submit" block loading={busy}>
        {t('verify')}
      </Button>
    </form>
  );
}
