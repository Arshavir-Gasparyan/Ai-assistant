import { buildApp } from './app.js';
import { loadEnv, type Env } from './config/env.js';
import { createPool } from './db/pool.js';
import { createLogger } from './logger.js';
import { createRedis } from './redis/client.js';

let env: Env;
try {
  env = loadEnv();
} catch (err) {
  // Config errors are for humans: print the message, skip the stack trace.
  console.error((err as Error).message);
  process.exit(1);
}

const log = createLogger(env);
const db = createPool(env.DATABASE_URL, log);
const redis = createRedis(env.REDIS_URL, log);

const app = buildApp(env, { log, db, redis });

// Graceful shutdown: `docker stop` sends SIGTERM. Stop accepting new requests, let
// in-flight ones finish (important later for streaming chat), then close connections.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    log.info({ signal }, 'Shutting down');
    await app.close();
    await Promise.allSettled([db.end(), redis.close()]);
    process.exit(0);
  });
}

// Connect Redis in the background, don't await it. If Redis is down at boot, connect()
// keeps retrying (reconnectStrategy) and would block forever. Not awaiting means the
// process still starts: /health (liveness) says "alive", /ready says "redis: error"
// until the connection succeeds. Postgres needs no connect: the pool is lazy.
redis.connect().catch((err: Error) => log.error({ err: err.message }, 'Redis connect failed'));

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (err) {
  log.error({ err }, 'Failed to start');
  process.exit(1);
}
