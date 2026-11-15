'use client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { Button } from '@tomoni/ui';
import { api } from './api';

export function SignOutButton() {
  const t = useTranslations('common');
  const router = useRouter();
  return (
    <Button
      variant="quiet"
      icon={<LogOut aria-hidden className="size-[1.1em]" />}
      onClick={async () => {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
        router.replace('/login');
        router.refresh();
      }}
    >
      {t('signOut')}
    </Button>
  );
}
