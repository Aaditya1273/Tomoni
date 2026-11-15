import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Redis } from 'ioredis';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { loadConfig, type ApiConfig } from './config';
import { loggerOptions } from './lib/log';
import { sessionPlugin } from './auth/session';
import { authRoutes } from './auth/routes';
import { systemRoutes } from './system/routes';

export interface BuildOptions {
  config?: Partial<ApiConfig>;
  logStream?: NodeJS.WritableStream;
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
  app.addHook('onClose', async () => {
    redis.disconnect();
  });

  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({ error: 'invalid_request', message: 'Request did not match the schema.' });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 429) return reply.code(429).send({ error: 'rate_limited', message: 'Too many requests. Try again shortly.' });
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
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute', redis, nameSpace: 'tomoni-rl:' });

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
  return app;
}
