'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-render the server page when a matching live event arrives (the event itself carries no data). */
export function LiveRefresh({ topics }: { topics: string[] }) {
  const router = useRouter();
  const key = topics.join(',');
  useEffect(() => {
    const es = new EventSource('/api/events');
    let t: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(t);
      t = setTimeout(() => router.refresh(), 250);
    };
    for (const topic of key.split(',')) es.addEventListener(topic, refresh);
    return () => {
      clearTimeout(t);
      es.close();
    };
  }, [key, router]);
  return null;
}
