import { createClient } from 'redis';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Redis will hold short-term conversation memory (Milestone 10): fast, in-memory,
 * with built-in key expiry (TTL), which suits "chat history for the last N hours".
 *
 * Unlike the pg pool, a Redis client must be explicitly connected (`await redis.connect()`).
 */
export function createRedis(url: string, log: FastifyBaseLogger) {
  const client = createClient({
    url,
    socket: {
      // On disconnect, retry with backoff: 100ms, 200ms, ... capped at 3s.
      reconnectStrategy: (retries) => Math.min(retries * 100, 3_000),
      connectTimeout: 5_000,
    },
  });

  // Same reason as pool.on('error'): an unhandled 'error' event would crash the process.
  client.on('error', (err: Error) => log.warn({ err: err.message }, 'Redis client error'));

  return client;
}

export type Redis = ReturnType<typeof createRedis>;
