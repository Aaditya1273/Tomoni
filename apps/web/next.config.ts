import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    '@tomoni/ui',
    '@tomoni/web-shared',
    '@tomoni/i18n',
    '@tomoni/contracts',
    '@tomoni/core',
  ],
  // Same-origin API: the browser only ever talks to this app, so cookies stay first-party.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API}/api/:path*` },
      { source: '/docs/:path*', destination: `${API}/docs/:path*` },
      { source: '/docs', destination: `${API}/docs` },
    ];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(config);
