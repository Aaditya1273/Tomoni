import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request CSP nonce (SECURITY S10). Scripts: nonce + strict-dynamic only.
 * Styles allow 'unsafe-inline' because React/Radix set style attributes, which nonces can't cover;
 * script execution is where XSS risk lives and stays strict.
 */
export function cspProxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV === 'development';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
  const reqHeaders = new Headers(request.headers);
  reqHeaders.set('x-nonce', nonce);
  reqHeaders.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set('content-security-policy', csp);
  res.headers.set('x-content-type-options', 'nosniff');
  res.headers.set('referrer-policy', 'no-referrer');
  res.headers.set('permissions-policy', 'camera=(), geolocation=(), microphone=(self)');
  return res;
}
