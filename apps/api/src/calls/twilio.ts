/**
 * Twilio voice webhooks. No session exists on these requests, so every one must carry a valid
 * X-Twilio-Signature (HMAC over our public URL and the POST body) or it is refused. Speech
 * comes back as Twilio's transcription in `SpeechResult` and goes through the same call engine
 * as the simulator, safety matcher first. Registered only when Twilio is configured.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { systemScope } from '@tomoni/core';
import { audit, schema, withScope } from '@tomoni/db';
import type { Queue } from 'bullmq';
import { line, verifyTwilio, type ConversationLLM, type Telephony } from '@tomoni/voice';
import { beginCall, CallError, callTurn } from './service';

const LANG: Record<string, string> = { hi: 'hi-IN', gu: 'gu-IN', ta: 'ta-IN', pa: 'pa-IN', bn: 'bn-IN' };
const xml = (s: string) =>
  s.replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!,
  );

function twiml(o: { say: string[]; locale: string; gatherUrl?: string; long?: boolean }) {
  const lang = LANG[o.locale] ?? 'en-US';
  const says = o.say.map((s) => `<Say language="${lang}">${xml(s)}</Say>`).join('');
  const body = o.gatherUrl
    ? `<Gather input="speech" language="${lang}" speechTimeout="${o.long ? 3 : 'auto'}" action="${xml(o.gatherUrl)}" method="POST">${says}</Gather><Redirect method="POST">${xml(o.gatherUrl)}</Redirect>`
    : `${says}<Hangup/>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

const Params = z.object({ callId: z.uuid() });

export const twilioRoutes =
  (deps: {
    authToken: string;
    publicApiOrigin: string;
    llm: ConversationLLM;
    speechAudio: boolean;
    telephony: Telephony;
    queue: Queue;
  }): FastifyPluginAsync =>
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

    /**
     * Voice Lab audio (D-032): record the patient's side for the speech task only. <Gather> keeps
     * transcribing, so the safety matcher still hears an emergency said mid-task (rule 2.1).
     * Research never breaks the care call: a failure here is logged and the call goes on.
     */
    const speechAudio = async (
      a: { start: boolean; over: boolean; sampleId: string | null },
      callSid: string,
      log: FastifyRequest['log'],
    ) => {
      try {
        if (a.start) await deps.telephony.startRecording(callSid);
        if (!a.over) return;
        const { ref } = await deps.telephony.stopRecording(callSid);
        // Skipped, cut short by a flag, or no consent any more: no sample, so the audio goes.
        if (a.sampleId) await deps.queue.add('research.audio', { sampleId: a.sampleId, recordingRef: ref });
        else await deps.telephony.deleteRecording(ref);
      } catch (e) {
        log.warn({ err: e }, 'speech audio skipped');
      }
    };

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
            const { rows } = await db.execute<{ region: 'US' | 'IN' }>(sql`SELECT h.region FROM care.patient p
              JOIN care.household h ON h.id = p.household_id WHERE p.id = ${c.patientId}`);
            return twiml({ say: [line(c.locale, 'voicemail', {}, rows[0]?.region)], locale: c.locale });
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
        const body = req.body as Record<string, string>;
        const said = String(body.SpeechResult ?? '').slice(0, 1000);
        let audio: { start: boolean; over: boolean; sampleId: string | null } | null = null;
        const [c] = await withScope('worker', scope, (db) =>
          db
            .select({ locale: schema.call.locale, recordingConsent: schema.call.recordingConsent })
            .from(schema.call)
            .where(eq(schema.call.id, callId)),
        );
        const locale = c?.locale ?? 'en';
        const out = await (async () => {
          if (!said) return twiml({ say: [line(locale, 'unclear')], locale, gatherUrl: turnUrl(callId) });
          try {
            const r = await callTurn((fn) => withScope('worker', scope, fn), callId, said, deps.llm, 'voice');
            // Audio only with the switch on and a patient who agreed to recording (state laws, D-032).
            if (deps.speechAudio && c?.recordingConsent && (r.speechStarted || r.speechOver))
              audio = { start: r.speechStarted, over: r.speechOver, sampleId: r.speechSampleId };
            // The research task is a 20-second narration: wait out short pauses instead of cutting in.
            return twiml({
              say: r.say,
              locale,
              long: r.speechTask,
              ...(r.ended ? {} : { gatherUrl: turnUrl(callId) }),
            });
          } catch (e) {
            // A turn taken twice keeps listening; an ended or unknown call hangs up.
            if (e instanceof CallError)
              return twiml({ say: [], locale, ...(e.code === 'busy' ? { gatherUrl: turnUrl(callId) } : {}) });
            throw e;
          }
        })();
        if (audio) await speechAudio(audio, body.CallSid ?? '', req.log);
        return send(reply, out);
      },
    );

    app.post(
      '/api/voice/twilio/:callId/status',
      { preHandler: signed, config: { rateLimit: false } },
      async (req, reply) => {
        const { callId } = Params.parse(req.params);
        const body = req.body as Record<string, string>;
        const status = String(body.CallStatus ?? '');
        // A hang-up during the speech task leaves a recording with no sample: delete it (D-032).
        if (status === 'completed' && deps.speechAudio && body.CallSid) {
          const [c] = await withScope('worker', scope, (db) =>
            db.select({ step: schema.call.step }).from(schema.call).where(eq(schema.call.id, callId)),
          );
          if (c?.step === 'speech_task')
            await deps.telephony
              .deleteCallRecordings(body.CallSid)
              .catch((e: unknown) => req.log.warn({ err: e }, 'speech audio cleanup failed'));
        }
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
