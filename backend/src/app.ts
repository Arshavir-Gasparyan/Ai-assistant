import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Env } from './config/env.js';
import type { Db } from './db/pool.js';
import { documentRoutes } from './documents/routes.js';
import type { Embedder } from './embeddings/embedder.js';
import type { ChatModel } from './llm/chat-model.js';
import { createRedisConversationStore, type ConversationStore } from './memory/store.js';
import { registerErrorHandlers } from './plugins/error-handler.js';
import { chatRoutes } from './rag/routes.js';
import type { Redis } from './redis/client.js';
import { healthRoutes } from './routes/health.js';
import { searchRoutes } from './search/routes.js';

/**
 * External resources the app needs, created OUTSIDE and passed in (dependency injection).
 * server.ts passes real connections; tests pass fakes, so unit tests need no Docker.
 */
export interface AppDeps {
  log: FastifyBaseLogger;
  db: Db;
  redis: Redis;
  embedder: Embedder;
  chatModel: ChatModel;
  /** Defaults to Redis-backed memory. Unit tests pass an in-memory store. */
  conversationStore?: ConversationStore;
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

  // File uploads (multipart/form-data). The JSON bodyLimit above does not apply to these.
  // Limits are enforced while streaming, so an oversized upload is rejected early.
  app.register(multipart, {
    limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 5, parts: 6 },
  });

  registerErrorHandlers(app);
  app.register(healthRoutes, {
    checks: {
      postgres: () => deps.db.query('SELECT 1'),
      redis: () => deps.redis.ping(),
    },
  });
  app.register(documentRoutes, { db: deps.db, embedder: deps.embedder });
  app.register(searchRoutes, { db: deps.db, embedder: deps.embedder, log: deps.log });
  app.register(chatRoutes, {
    db: deps.db,
    embedder: deps.embedder,
    chatModel: deps.chatModel,
    store: deps.conversationStore ?? createRedisConversationStore(deps.redis, env.MEMORY_TTL_SECONDS),
    conversationTokenBudget: env.CONVERSATION_TOKEN_BUDGET,
  });

  return app;
}

export type App = ReturnType<typeof buildApp>;
