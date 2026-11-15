import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import { Health, SandboxStatus } from '@tomoni/contracts';
import { pool, realDataEnabled } from '@tomoni/db';

/** Adapters are chosen by TOMONI_ADAPTER_<NAME>=real|mock; anything not "real" counts as a mock. */
export function mockAdapters(envVars: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(envVars)
    .filter(([k, v]) => k.startsWith('TOMONI_ADAPTER_') && v !== 'real')
    .map(([k]) => k.slice('TOMONI_ADAPTER_'.length).toLowerCase())
    .sort();
}

export const systemRoutes =
  (redis: Redis): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/api/system/health',
      { config: { rateLimit: false }, schema: { tags: ['system'], response: { 200: Health, 503: Health } } },
      async (_req, reply) => {
        const db = await pool('app')
          .query('SELECT 1')
          .then(
            () => true,
            () => false,
          );
        const r = await redis.ping().then(
          (p) => p === 'PONG',
          () => false,
        );
        return reply.code(db && r ? 200 : 503).send({ ok: db && r, db, redis: r });
      },
    );

    // Drives the SANDBOX badge on every screen (BUILD_PROMPT rule 0.3).
    app.get(
      '/api/system/sandbox',
      { config: { rateLimit: false }, schema: { tags: ['system'], response: { 200: SandboxStatus } } },
      async () => {
        const mocks = mockAdapters();
        return {
          sandbox: mocks.length > 0 || !realDataEnabled(),
          mockAdapters: mocks,
          realDataEnabled: realDataEnabled(),
        };
      },
    );
  };
