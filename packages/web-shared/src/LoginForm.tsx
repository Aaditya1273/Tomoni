'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { LoginResponse } from '@tomoni/contracts';
import { Button, Notice, TextField } from '@tomoni/ui';
import { api, ApiError } from './api';

export function LoginForm() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await api<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: { email: String(f.get('email')), password: String(f.get('password')) },
      });
      router.replace(res.next === 'none' ? '/' : '/mfa');
      router.refresh();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 401) setError(t('badCredentials'));
      else if (err instanceof ApiError && err.status === 429) setError(t('rateLimited'));
      else setError(tc('errorGeneric'));
    }
  }

  return (
    // method="post": if someone submits before hydration, the browser must never put the
    // password in the URL (history, logs, Referer).
    <form method="post" onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {error && <Notice tone="act" title={error} />}
      <TextField
        label={t('email')}
        name="email"
        type="email"
        autoComplete="username"
        required
        inputMode="email"
      />
      <TextField
        label={t('password')}
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" block loading={busy}>
        {busy ? t('signingIn') : t('signIn')}
      </Button>
    </form>
  );
}
