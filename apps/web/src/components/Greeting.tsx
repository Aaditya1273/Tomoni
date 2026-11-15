'use client';
import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';

const part = () => {
  const h = new Date().getHours();
  return h < 12 ? 'greetingMorning' : h < 17 ? 'greetingAfternoon' : 'greetingEvening';
};

/** Greets by the viewer's local time; server renders the morning form, the client corrects it. */
export function Greeting({ name }: { name: string }) {
  const t = useTranslations('family');
  const key = useSyncExternalStore(
    () => () => {},
    part,
    () => 'greetingMorning' as const,
  );
  return (
    <h1
      className="text-3xl leading-[1.08] font-semibold tracking-[-0.015em] text-balance sm:text-4xl"
      style={{ fontStretch: '100%' }}
    >
      {t(key, { name })}
    </h1>
  );
}
