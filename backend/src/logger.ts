import { pino, type Logger } from 'pino';
import type { Env } from './config/env.js';

/**
 * One logger for the whole process: Fastify, the Postgres pool, Redis, and later
 * the LLM call logger all write through it, so every log line has the same format.
 */
export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  return pino({
    level: env.LOG_LEVEL,
    // Never log credentials. More paths get added once we handle API keys and user data.
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    // Human-readable logs in dev; raw JSON elsewhere (log tools parse JSON).
    ...(env.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } },
    }),
  });
}
