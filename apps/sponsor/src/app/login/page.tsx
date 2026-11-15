import { getTranslations } from 'next-intl/server';
import { Notice } from '@tomoni/ui';
import { LoginForm } from '@tomoni/web-shared';
import { AuthShell } from '@tomoni/web-shared/root';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ notPartner?: string }>;
}) {
  const [t, sp] = await Promise.all([getTranslations(), searchParams]);
  return (
    <AuthShell title={t('sponsor.title')} lead={t('sponsor.lead')}>
      {sp.notPartner && <Notice tone="watch" title={t('auth.notPartner')} />}
      <LoginForm />
    </AuthShell>
  );
}
