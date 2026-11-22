import type { AppDeps } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createFakeEmbedder } from '../src/embeddings/fake-embedder.js';
import { createFakeChatModel } from '../src/llm/fake-chat.js';
import { createLogger } from '../src/logger.js';

export function testEnv(overrides: Record<string, string> = {}) {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://test:test@localhost:5433/test',
    REDIS_URL: 'redis://localhost:6379',
    ...overrides,
  });
}

/**
 * Fake Postgres/Redis so unit tests run without Docker. Only the methods the app
 * actually calls are implemented; the cast tells TypeScript "trust me" for the rest.
 */
export function fakeDeps(opts: { dbDown?: boolean; redisDown?: boolean } = {}): AppDeps {
  const db = {
    query: async () => {
      if (opts.dbDown) throw new Error('connect ECONNREFUSED 127.0.0.1:5433');
      return { rows: [{ '?column?': 1 }] };
    },
  };
  const redis = {
    ping: async () => {
      if (opts.redisDown) throw new Error('The client is closed');
      return 'PONG';
    },
  };
  return {
    log: createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }),
    db: db as unknown as AppDeps['db'],
    redis: redis as unknown as AppDeps['redis'],
    embedder: createFakeEmbedder(),
    chatModel: createFakeChatModel(),
  };
}
