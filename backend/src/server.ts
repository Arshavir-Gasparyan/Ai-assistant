import { buildApp } from './app.js';
import { loadEnv, type Env } from './config/env.js';

let env: Env;
try {
  env = loadEnv();
} catch (err) {
  // Config errors are for humans: print the message, skip the stack trace.
  console.error((err as Error).message);
  process.exit(1);
}

const app = buildApp(env);

// Graceful shutdown: `docker stop` sends SIGTERM. We stop accepting new requests and
// let in-flight ones finish (important later for streaming chat responses), then exit.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
