/**
 * Live updates (BUILD_PROMPT §3 "Real-time", D-004): one Redis subscription per API process,
 * fanned out over Server-Sent Events to every signed-in browser that may see the event.
 * Events carry ids and types only; the browser refetches what changed through the normal,
 * RLS-scoped routes. Each heartbeat re-checks the session without refreshing it, so a sign-out
 * or idle timeout closes the stream and an open tab never keeps a session alive.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Redis } from 'ioredis';
import { AppEvent, EVENTS_CHANNEL } from '@tomoni/contracts';
import type { RequestScope } from '@tomoni/core';
import { pool } from '@tomoni/db';
import { requireAuth, SESSION_COOKIE, sha256 } from '../auth/session';

const HEARTBEAT_MS = 20_000;

export const visibleTo = (s: RequestScope, e: AppEvent) =>
  s.isAdmin ||
  (e.practiceId !== null && s.staffPracticeIds.includes(e.practiceId)) ||
  (e.householdId !== null && s.householdIds.includes(e.householdId));

export const eventRoutes =
  (redisUrl: string): FastifyPluginAsyncZod =>
  async (app) => {
    const clients = new Set<{ scope: RequestScope; send: (e: AppEvent) => void }>();
    const sub = new Redis(redisUrl);
    await sub.subscribe(EVENTS_CHANNEL);
    sub.on('message', (_channel, raw) => {
      const parsed = AppEvent.safeParse(JSON.parse(raw));
      if (!parsed.success) return;
      for (const c of clients) if (visibleTo(c.scope, parsed.data)) c.send(parsed.data);
    });
    app.addHook('onClose', async () => {
      sub.disconnect();
    });

    app.get(
      '/api/events',
      {
        preHandler: requireAuth(),
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: { tags: ['system'] },
      },
      async (req, reply) => {
        const token = req.cookies[SESSION_COOKIE]!;
        reply.hijack();
        const res = reply.raw;
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
          'x-content-type-options': 'nosniff',
        });
        res.write('retry: 3000\n: connected\n\n');
        const client = {
          scope: req.auth!.scope,
          send: (e: AppEvent) => res.write(`id: ${e.id}\nevent: ${e.topic}\ndata: ${JSON.stringify(e)}\n\n`),
        };
        clients.add(client);
        const beat = setInterval(async () => {
          const { rows } = await pool('app')
            .query<{ ok: boolean }>('SELECT auth.session_alive($1) AS ok', [sha256(token)])
            .catch(() => ({ rows: [{ ok: false }] }));
          if (!rows[0]?.ok) return res.end();
          res.write(': ping\n\n');
        }, HEARTBEAT_MS);
        req.raw.on('close', () => {
          clearInterval(beat);
          clients.delete(client);
        });
      },
    );
  };
