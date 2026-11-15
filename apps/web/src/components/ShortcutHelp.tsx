'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from 'radix-ui';
import { Keyboard, X } from 'lucide-react';
import { Kbd } from '@tomoni/ui';

/** "?" opens the shortcut list from anywhere on the desk (keyboard-first, BUILD_PROMPT §7). */
export function ShortcutHelp() {
  const t = useTranslations('desk');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
      if (e.key === '?' && !typing) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const rows: [string, string][] = [
    ['j', t('shortcutNext')],
    ['k', t('shortcutPrev')],
    ['s', t('shortcutSign')],
    ['?', t('shortcutHelp')],
  ];
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="inline-flex min-h-target items-center gap-1.5 rounded-control px-2 text-sm text-muted hover:text-ink">
        <Keyboard aria-hidden className="size-4" />
        <Kbd>?</Kbd>
        <span className="sr-only">{t('shortcuts')}</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          data-surface="desk"
          className="fixed top-1/2 left-1/2 z-50 w-[min(26rem,92vw)] -translate-1/2 rounded-panel border border-line bg-surface p-5"
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="font-semibold">{t('shortcuts')}</Dialog.Title>
            <Dialog.Close className="inline-flex min-h-target min-w-target items-center justify-center rounded-control text-muted hover:text-ink">
              <X aria-hidden className="size-4" />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{t('shortcuts')}</Dialog.Description>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            {rows.map(([k, label]) => (
              <div key={k} className="contents">
                <dt>
                  <Kbd>{k}</Kbd>
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
