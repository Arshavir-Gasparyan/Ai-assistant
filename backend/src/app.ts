import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Env } from './config/env.js';
import { registerErrorHandlers } from './plugins/error-handler.js';
import { healthRoutes } from './routes/health.js';

/**
 * Builds the Fastify app WITHOUT starting to listen.
 *
 * Splitting "build" (app.ts) from "listen" (server.ts) is what makes the API testable:
 * tests call buildApp() and use app.inject() to send fake HTTP requests in-memory.
 * No port is opened, so tests stay fast and can run in parallel.
 */
export function buildApp(env: Env) {
  const logger: FastifyServerOptions['logger'] = {
    level: env.LOG_LEVEL,
    // Never log credentials. More paths get added once we handle API keys and user data.
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    // Human-readable logs in dev; raw JSON elsewhere (log tools parse JSON).
    ...(env.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } },
    }),
  };

  const app = Fastify({
    logger,
    // Default body limit for JSON. File uploads (M5) get their own explicit limit.
    bodyLimit: 1024 * 1024, // 1 MB
  }).withTypeProvider<ZodTypeProvider>();

  // Teach Fastify to use Zod schemas for validating requests and serializing responses.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandlers(app);
  app.register(healthRoutes);

  return app;
}

export type App = ReturnType<typeof buildApp>;
