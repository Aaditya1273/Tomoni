import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { JOB_DEFAULTS, QUEUE } from '@tomoni/contracts';
import type { BlueButton } from '@tomoni/medicines';
import type { ConversationLLM } from '@tomoni/voice';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { loadConfig, type ApiConfig } from './config';
import { loggerOptions } from './lib/log';
import { SESSION_COOKIE, sessionPlugin, sha256 } from './auth/session';
import { authRoutes } from './auth/routes';
import { systemRoutes } from './system/routes';
import { familyRoutes } from './medicines/family';
import { adminRoutes } from './medicines/admin';
import { eventRoutes } from './events/routes';
import { callRoutes } from './calls/routes';
import { twilioRoutes } from './calls/twilio';
import { actionRoutes } from './actions/routes';
import { deskRoutes } from './desk/routes';
import { familyExtraRoutes } from './family/routes';
import { familyMedicineRoutes } from './family/medicines';
import { researchRoutes } from './research/routes';
import { sponsorRoutes } from './sponsor/routes';
import { llmFromEnv } from '@tomoni/voice';

export interface BuildOptions {
  config?: Partial<ApiConfig>;
  logStream?: NodeJS.WritableStream;
  /** Tests inject a Blue Button adapter; otherwise TOMONI_ADAPTER_BLUEBUTTON decides. */
  blueButton?: BlueButton;
  /** Tests inject the conversation LLM; otherwise TOMONI_ADAPTER_LLM decides. */
  llm?: ConversationLLM;
}

export async function buildServer(opts: BuildOptions = {}) {
  const config = { ...loadConfig(), ...opts.config };
  const app = Fastify({
    logger: loggerOptions(opts.logStream),
    bodyLimit: 1024 * 1024, // SECURITY S11
    trustProxy: false,
    genReqId: () => crypto.randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
  const queueRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE, {
    connection: queueRedis,
    prefix: config.queuePrefix,
    defaultJobOptions: JOB_DEFAULTS,
  });
  app.addHook('onClose', async () => {
    await queue.close();
    queueRedis.disconnect();
    redis.disconnect();
  });

  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({ error: 'invalid_request', message: 'Request did not match the schema.' });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 429)
      return reply
        .code(429)
        .send({ error: 'rate_limited', message: 'Too many requests. Try again shortly.' });
    if (status < 500) return reply.code(status).send({ error: 'bad_request', message: 'Bad request.' });
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong. It has been logged.' });
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cache-control', 'no-store');
  });

  await app.register(cookie);
  // Keyed by session when there is one: server-side rendering reaches the API from one IP
  // (the web server), so a per-IP global limit would make every user share one budget.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    redis,
    nameSpace: 'tomoni-rl:',
    keyGenerator: (req) => {
      const sid = req.cookies?.[SESSION_COOKIE];
      return sid ? `sid:${sha256(sid).toString('hex')}` : `ip:${req.ip}`;
    },
  });
  // Account-spraying guard: all login attempts from one IP, across accounts.
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'POST' || req.url !== '/api/auth/login') return;
    const key = `tomoni-rl:login-ip:${req.ip}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 60);
    if (n > 60)
      return reply
        .code(429)
        .send({ error: 'rate_limited', message: 'Too many requests. Try again shortly.' });
  });

  if (config.docs) {
    await app.register(swagger, {
      openapi: { info: { title: 'Tomoni API', version: '0.1.0' } },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  // Called directly (not app.register) so its hooks apply to every route, not just an encapsulated child.
  await sessionPlugin(app, { allowedOrigins: config.allowedOrigins });
  await app.register(authRoutes);
  await app.register(systemRoutes(redis));
  await app.register(
    familyRoutes({
      redis,
      queue,
      publicOrigin: config.publicOrigin,
      ...(opts.blueButton ? { blueButton: opts.blueButton } : {}),
    }),
  );
  await app.register(adminRoutes({ queue }));
  await app.register(eventRoutes(config.redisUrl));
  const llm = opts.llm ?? llmFromEnv();
  await app.register(callRoutes({ simulator: config.simulator, llm, queue }));
  await app.register(actionRoutes({ queue }));
  await app.register(deskRoutes);
  await app.register(familyExtraRoutes({ publicOrigin: config.publicOrigin }));
  await app.register(familyMedicineRoutes({ queue }));
  await app.register(researchRoutes({ queue }));
  await app.register(sponsorRoutes);
  if (config.twilio) await app.register(twilioRoutes({ ...config.twilio, llm }));
  return app;
}
