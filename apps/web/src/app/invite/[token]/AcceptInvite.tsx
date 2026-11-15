'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Notice, TextField } from '@tomoni/ui';
import { api } from '@tomoni/web-shared';

export function AcceptInvite({ token }: { token: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [bad, setBad] = useState(!token);
  const [busy, setBusy] = useState(false);
  if (bad) return <Notice tone="watch">{t('acceptInvalid')}</Notice>;
  return (
    <form
      method="post"
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api('/api/invites/accept', { method: 'POST', body: { token, displayName: name, password } });
          router.push('/login?invited=1');
        } catch {
          setBad(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <TextField
        label={t('acceptName')}
        required
        maxLength={100}
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <TextField
        label={t('acceptPassword')}
        type="password"
        required
        minLength={12}
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button type="submit" disabled={busy}>
        {t('acceptButton')}
      </Button>
    </form>
  );
}
