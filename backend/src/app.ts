import cors from '@fastify/cors';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Env } from './config/env.js';
import type { Db } from './db/pool.js';
import { registerErrorHandlers } from './plugins/error-handler.js';
import type { Redis } from './redis/client.js';
import { healthRoutes } from './routes/health.js';

/**
 * External resources the app needs, created OUTSIDE and passed in (dependency injection).
 * server.ts passes real connections; tests pass fakes, so unit tests need no Docker.
 */
export interface AppDeps {
  log: FastifyBaseLogger;
  db: Db;
  redis: Redis;
}

/**
 * Builds the Fastify app WITHOUT starting to listen.
 *
 * Splitting "build" (app.ts) from "listen" (server.ts) is what makes the API testable:
 * tests call buildApp() and use app.inject() to send fake HTTP requests in-memory.
 * No port is opened, so tests stay fast and can run in parallel.
 */
export function buildApp(env: Env, deps: AppDeps) {
  const app = Fastify({
    loggerInstance: deps.log,
    // Default body limit for JSON. File uploads (M5) get their own explicit limit.
    bodyLimit: 1024 * 1024, // 1 MB
  }).withTypeProvider<ZodTypeProvider>();

  // Teach Fastify to use Zod schemas for validating requests and serializing responses.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // CORS: the browser blocks JS on http://localhost:3000 from reading responses from
  // http://localhost:4000 (a different origin) unless the API explicitly allows it.
  // We allow-list exact origins. Never use `origin: true` / "*" for an API like this.
  app.register(cors, {
    origin: env.CORS_ORIGINS,
    methods: ['GET', 'POST', 'DELETE'],
  });

  registerErrorHandlers(app);
  app.register(healthRoutes, {
    checks: {
      postgres: () => deps.db.query('SELECT 1'),
      redis: () => deps.redis.ping(),
    },
  });

  return app;
}

export type App = ReturnType<typeof buildApp>;
