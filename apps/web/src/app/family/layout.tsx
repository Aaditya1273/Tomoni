import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Wordmark } from '@tomoni/ui';
import { SignOutButton } from '@tomoni/web-shared';
import { requireSurface } from '@tomoni/web-shared/server';

export default async function FamilyLayout({ children }: { children: ReactNode }) {
  await requireSurface('family');
  const t = await getTranslations('common');
  return (
    <div
      data-surface="family"
      className="mx-auto flex min-h-dvh w-full max-w-[34rem] flex-col px-5 pt-10 pb-8"
    >
      <a href="#main" className="sr-only focus:not-sr-only focus:mb-2">
        {t('skipToContent')}
      </a>
      <header className="flex items-center justify-between gap-4">
        <Wordmark className="text-xl" />
        <SignOutButton />
      </header>
      {children}
    </div>
  );
}
