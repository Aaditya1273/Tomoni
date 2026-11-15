import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { requireSurface } from '@tomoni/web-shared/server';
import { InviteForm } from './InviteForm';

export const metadata = { title: 'Invite family' };

export default async function InvitePage() {
  await requireSurface('family');
  const t = await getTranslations('family');
  return (
    <main id="main" className="flex flex-1 flex-col gap-6 pt-8">
      <Link href="/family" className="inline-flex items-center gap-2 self-start font-semibold text-neel">
        <ArrowLeft aria-hidden className="size-5" />
        {t('evidence.back')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('invite.title')}</h1>
      <p className="text-muted">{t('invite.help')}</p>
      <InviteForm />
    </main>
  );
}
