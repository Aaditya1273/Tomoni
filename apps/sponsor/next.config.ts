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
  // Only auth, identity, system status and (Phase 5) the sponsor API are reachable from this origin.
  // The care API is not proxied here at all (D-002).
  async rewrites() {
    return [
      { source: '/api/auth/:path*', destination: `${API}/api/auth/:path*` },
      { source: '/api/me', destination: `${API}/api/me` },
      { source: '/api/system/:path*', destination: `${API}/api/system/:path*` },
      { source: '/sponsor-api/:path*', destination: `${API}/sponsor-api/:path*` },
    ];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(config);
