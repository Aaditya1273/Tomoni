/**
 * Twilio voice webhooks. No session exists on these requests, so every one must carry a valid
 * X-Twilio-Signature (HMAC over our public URL and the POST body) or it is refused. Speech
 * comes back as Twilio's transcription in `SpeechResult` and goes through the same call engine
 * as the simulator, safety matcher first. Registered only when Twilio is configured.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { systemScope } from '@tomoni/core';
import { audit, schema, withScope } from '@tomoni/db';
import { line, verifyTwilio, type ConversationLLM } from '@tomoni/voice';
import { beginCall, CallError, callTurn } from './service';

const LANG: Record<string, string> = { hi: 'hi-IN', gu: 'gu-IN', ta: 'ta-IN', pa: 'pa-IN', bn: 'bn-IN' };
const xml = (s: string) =>
  s.replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!,
  );

function twiml(o: { say: string[]; locale: string; gatherUrl?: string }) {
  const lang = LANG[o.locale] ?? 'en-US';
  const says = o.say.map((s) => `<Say language="${lang}">${xml(s)}</Say>`).join('');
  const body = o.gatherUrl
    ? `<Gather input="speech" language="${lang}" speechTimeout="auto" action="${xml(o.gatherUrl)}" method="POST">${says}</Gather><Redirect method="POST">${xml(o.gatherUrl)}</Redirect>`
    : `${says}<Hangup/>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

const Params = z.object({ callId: z.uuid() });

export const twilioRoutes =
  (deps: { authToken: string; publicApiOrigin: string; llm: ConversationLLM }): FastifyPluginAsync =>
  async (app) => {
    app.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string', bodyLimit: 64 * 1024 },
      (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
    );
    const scope = systemScope('telephony');

    const signed = async (req: FastifyRequest, reply: FastifyReply) => {
      const url = `${deps.publicApiOrigin}${req.url}`;
      const ok = verifyTwilio(
        deps.authToken,
        url,
        (req.body ?? {}) as Record<string, string>,
        req.headers['x-twilio-signature'] as string | undefined,
      );
      if (!ok) return reply.code(403).send({ error: 'bad_signature', message: 'Signature check failed.' });
    };
    // Handlers build the TwiML inside the transaction and send it after commit.
    const send = (reply: FastifyReply, body: string) => reply.type('text/xml').send(body);
    const turnUrl = (id: string) => `${deps.publicApiOrigin}/api/voice/twilio/${id}/turn`;

    app.post(
      '/api/voice/twilio/:callId/answer',
      { preHandler: signed, config: { rateLimit: false } },
      async (req, reply) => {
        const { callId } = Params.parse(req.params);
        const body = req.body as Record<string, string>;
        const out = await withScope('worker', scope, async (db) => {
          const [c] = await db.select().from(schema.call).where(eq(schema.call.id, callId));
          if (!c) return twiml({ say: [], locale: 'en' });
          if (body.AnsweredBy?.startsWith('machine')) {
            await db
              .update(schema.call)
              .set({ step: 'ended', outcome: 'voicemail', endedAt: new Date() })
              .where(eq(schema.call.id, callId));
            return twiml({ say: [line(c.locale, 'voicemail')], locale: c.locale });
          }
          try {
            const r = await beginCall(db, {
              patientId: c.patientId,
              llm: deps.llm,
              channel: 'voice',
              callId,
            });
            return twiml({ say: r.say, locale: c.locale, gatherUrl: turnUrl(callId) });
          } catch (e) {
            if (e instanceof CallError) return twiml({ say: [], locale: c.locale });
            throw e;
          }
        });
        return send(reply, out);
      },
    );

    app.post(
      '/api/voice/twilio/:callId/turn',
      { preHandler: signed, config: { rateLimit: false } },
      async (req, reply) => {
        const { callId } = Params.parse(req.params);
        const said = String((req.body as Record<string, string>).SpeechResult ?? '').slice(0, 1000);
        const out = await withScope('worker', scope, async (db) => {
          const [c] = await db
            .select({ locale: schema.call.locale })
            .from(schema.call)
            .where(eq(schema.call.id, callId));
          const locale = c?.locale ?? 'en';
          if (!said) return twiml({ say: [line(locale, 'unclear')], locale, gatherUrl: turnUrl(callId) });
          try {
            const r = await callTurn(db, callId, said, deps.llm, 'voice');
            return twiml({ say: r.say, locale, ...(r.ended ? {} : { gatherUrl: turnUrl(callId) }) });
          } catch (e) {
            if (e instanceof CallError) return twiml({ say: [], locale });
            throw e;
          }
        });
        return send(reply, out);
      },
    );

    app.post(
      '/api/voice/twilio/:callId/status',
      { preHandler: signed, config: { rateLimit: false } },
      async (req, reply) => {
        const { callId } = Params.parse(req.params);
        const status = String((req.body as Record<string, string>).CallStatus ?? '');
        const outcome = { 'no-answer': 'no_answer', busy: 'no_answer', failed: 'failed', canceled: 'failed' }[
          status
        ] as 'no_answer' | 'failed' | undefined;
        if (outcome)
          await withScope('worker', scope, async (db) => {
            const [c] = await db
              .update(schema.call)
              .set({ step: 'ended', outcome, endedAt: new Date() })
              .where(eq(schema.call.id, callId))
              .returning({ patientId: schema.call.patientId, step: schema.call.step });
            if (c)
              await audit(db, {
                action: 'update',
                entityType: 'call',
                entityId: callId,
                patientId: c.patientId,
                purpose: 'treatment',
                details: { outcome },
              });
          });
        return reply.code(204).send();
      },
    );
  };
