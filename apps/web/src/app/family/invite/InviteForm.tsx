'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Notice, TextField } from '@tomoni/ui';
import { api, ApiError } from '@tomoni/web-shared';

export function InviteForm() {
  const t = useTranslations('family.invite');
  const [kind, setKind] = useState<'sibling' | 'doctor'>('sibling');
  const [email, setEmail] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <form
      method="post"
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          const r = await api<{ acceptUrl: string | null }>('/api/family/invites', {
            method: 'POST',
            body: { kind, email },
          });
          setLink(r.acceptUrl);
          setDone(true);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : String(err));
        }
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">{t('kind')}</legend>
        {(['sibling', 'doctor'] as const).map((k) => (
          <label key={k} className="flex min-h-target items-center gap-3">
            <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
            {t(k)}
          </label>
        ))}
      </fieldset>
      <TextField
        label={t('email')}
        type="email"
        required
        autoComplete="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button type="submit" className="self-start">
        {t('send')}
      </Button>
      {error && <Notice tone="act">{error}</Notice>}
      {done && link && (
        <Notice tone="ok" title={t('link')}>
          <p className="break-all" data-invite-link>
            {link}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-2"
            onClick={async () => {
              await navigator.clipboard.writeText(link).catch(() => {});
              setCopied(true);
            }}
          >
            {copied ? t('copied') : t('copy')}
          </Button>
        </Notice>
      )}
      {done && !link && <Notice tone="ok">{t('doctorDone')}</Notice>}
    </form>
  );
}
