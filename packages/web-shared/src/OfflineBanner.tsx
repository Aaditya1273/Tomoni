'use client';
import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { WifiOff } from 'lucide-react';

const subscribe = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

export function OfflineBanner() {
  const t = useTranslations('common');
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-2 bg-ink px-4 py-3 text-paper"
    >
      <WifiOff aria-hidden className="size-5" />
      {t('offline')}
    </div>
  );
}
