import { env } from '@tomoni/db';

export interface ApiConfig {
  port: number;
  /** Origins allowed to make state-changing requests (SECURITY S9). */
  allowedOrigins: string[];
  redisUrl: string;
  docs: boolean;
  /** The web origin families use; OAuth callbacks come back through it. */
  publicOrigin: string;
  /** BullMQ key prefix, so test and e2e stacks never share a queue with dev. */
  queuePrefix: string;
  /** The browser call simulator (§5.4) exists outside production only. */
  simulator: boolean;
  /** Twilio voice webhooks; absent unless Twilio is configured. */
  twilio: { authToken: string; publicApiOrigin: string } | null;
}

export function loadConfig(): ApiConfig {
  const e = env();
  return {
    port: Number(process.env.API_PORT ?? 4000),
    allowedOrigins: (
      process.env.TOMONI_ALLOWED_ORIGINS ??
      `http://localhost:${process.env.WEB_PORT ?? 3000},http://localhost:${process.env.SPONSOR_PORT ?? 3100}`
    ).split(','),
    redisUrl: e.REDIS_URL,
    docs: e.NODE_ENV !== 'production',
    publicOrigin: process.env.TOMONI_PUBLIC_ORIGIN ?? `http://localhost:${process.env.WEB_PORT ?? 3000}`,
    queuePrefix: process.env.TOMONI_QUEUE_PREFIX ?? 'bull',
    simulator: e.NODE_ENV !== 'production',
    twilio: process.env.TOMONI_TWILIO_AUTH_TOKEN
      ? {
          authToken: process.env.TOMONI_TWILIO_AUTH_TOKEN,
          publicApiOrigin:
            process.env.TOMONI_PUBLIC_API_ORIGIN ?? `http://localhost:${process.env.API_PORT ?? 4000}`,
        }
      : null,
  };
}
