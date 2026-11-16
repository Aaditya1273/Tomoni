'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Tells the server the viewer's time zone once, so times of day render in it (Prefs.timeZone). */
export function TimeZoneCookie() {
  const router = useRouter();
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Compared with the cookie, not the server's normalized name, so it can never loop.
    if (!tz || !/^[\w+/-]+$/.test(tz) || document.cookie.includes(`tomoni_tz=${tz}`)) return;
    document.cookie = `tomoni_tz=${tz}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    router.refresh();
  }, [router]);
  return null;
}
