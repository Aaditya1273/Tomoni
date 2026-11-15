import type { NextRequest } from 'next/server';
import { cspProxy } from '@tomoni/web-shared/proxy';

export function proxy(request: NextRequest) {
  return cspProxy(request);
}

// Must be a literal here: Next reads it statically.
export const config = {
  matcher: [
    {
      source: '/((?!api|docs|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
