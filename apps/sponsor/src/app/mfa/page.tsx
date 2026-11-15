import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { MfaForm } from '@tomoni/web-shared';
import { AuthShell } from '@tomoni/web-shared/root';
import { getMe } from '@tomoni/web-shared/server';

export const metadata = { title: 'Two-step sign-in' };

export default async function MfaPage() {
  const me = await getMe();
  if (!me) redirect('/login');
  if (!me.mfa.required || me.mfa.verified) redirect('/');
  const t = await getTranslations('auth');
  const mode = me.mfa.enabled ? 'verify' : 'enroll';
  return (
    <AuthShell
      title={mode === 'enroll' ? t('mfaEnrollTitle') : t('mfaVerifyTitle')}
      lead={mode === 'enroll' ? t('mfaEnrollLead') : t('mfaVerifyLead')}
    >
      <MfaForm mode={mode} />
    </AuthShell>
  );
}
