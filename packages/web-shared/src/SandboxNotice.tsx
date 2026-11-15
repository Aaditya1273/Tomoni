'use client';
import { useTranslations } from 'next-intl';
import { SandboxBadge } from '@tomoni/ui';

export function SandboxNotice({ mocks }: { mocks: string[] }) {
  const t = useTranslations('common');
  return (
    <SandboxBadge
      label={t('sandboxLabel')}
      short={t('sandboxShort')}
      detail={mocks.length ? t('sandboxDetail', { mocks: mocks.join(', ') }) : t('sandboxNoMocks')}
    />
  );
}
