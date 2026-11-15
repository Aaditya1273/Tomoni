import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@tomoni/web-shared/root';
import { AcceptInvite } from './AcceptInvite';

export const metadata = { title: 'Join your family' };

/** Public: the link a sibling received. The token itself is the authority (single use, 7 days). */
export default async function InviteAccept({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('auth');
  return (
    <AuthShell title={t('acceptTitle')}>
      <AcceptInvite token={/^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : ''} />
    </AuthShell>
  );
}
