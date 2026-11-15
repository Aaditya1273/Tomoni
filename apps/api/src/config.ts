import { env } from '@tomoni/db';

export interface ApiConfig {
  port: number;
  /** Origins allowed to make state-changing requests (SECURITY S9). */
  allowedOrigins: string[];
  redisUrl: string;
  docs: boolean;
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
  };
}
