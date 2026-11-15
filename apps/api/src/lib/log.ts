import type { FastifyServerOptions } from 'fastify';

/**
 * PHI-free logging (SECURITY S13). Requests log method + path only (query strings can carry
 * names or ids), never bodies, cookies or tokens. Any string value that looks like a phone
 * number, MBI or e-mail is scrubbed as a second line of defence.
 */
const PATTERNS: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // e-mail
  /\b\d[A-Za-z][A-Za-z0-9]\d[A-Za-z][A-Za-z0-9]\d[A-Za-z]{2}\d{2}\b/g, // MBI shape
  /\+?\d[\d\s().-]{8,}\d/g, // phone-ish
];

export function scrub(s: string): string {
  return PATTERNS.reduce((acc, re) => acc.replace(re, '[redacted]'), s);
}

function scrubDeep(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return scrub(v);
  if (depth > 5 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => scrubDeep(x, depth + 1));
  // Only plain objects: request/reply/error instances go through their own serializers.
  if (Object.getPrototypeOf(v) !== Object.prototype) return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x, depth + 1)]));
}

export function loggerOptions(stream?: NodeJS.WritableStream): NonNullable<FastifyServerOptions['logger']> {
  return {
    level: process.env.LOG_LEVEL ?? 'info',
    ...(stream ? { stream } : {}),
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.email',
        '*.code',
      ],
      censor: '[redacted]',
    },
    serializers: {
      req: (req: { method: string; url: string; id: string }) => ({
        id: req.id,
        method: req.method,
        path: (req.url ?? '').split('?')[0],
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      err: (err: Error & { code?: string; statusCode?: number }) => ({
        type: err.name,
        code: err.code,
        statusCode: err.statusCode,
        message: scrub(err.message),
        stack: scrub(err.stack ?? ''),
      }),
    },
    hooks: {
      logMethod(args, method) {
        method.apply(this, args.map((a) => scrubDeep(a)) as Parameters<typeof method>);
      },
    },
  };
}
