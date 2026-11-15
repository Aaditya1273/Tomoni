import { getTranslations } from 'next-intl/server';
import { Notice } from '@tomoni/ui';
import { LoginForm } from '@tomoni/web-shared';
import { AuthShell } from '@tomoni/web-shared/root';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ wrongApp?: string }> }) {
  const [t, sp] = await Promise.all([getTranslations('auth'), searchParams]);
  return (
    <AuthShell title={t('signInTitle')} lead={t('signInLead')}>
      {sp.wrongApp && <Notice tone="watch" title={t('wrongApp')} />}
      <LoginForm />
    </AuthShell>
  );
}
