import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/** A named dependency check: resolves if healthy, throws/rejects if not. */
export type ReadinessCheck = () => Promise<unknown>;

export interface HealthRoutesOptions {
  checks: Record<string, ReadinessCheck>;
  timeoutMs?: number;
}

const healthResponse = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number(),
  timestamp: z.string(),
});

const readyResponse = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.record(z.string(), z.enum(['ok', 'error'])),
});

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Two different questions, two endpoints:
 *
 * GET /health (LIVENESS):  "Is the process alive?"  Never checks dependencies.
 *   If it fails, the orchestrator RESTARTS the container. Restarting the API because
 *   Redis blipped would not fix Redis, it would just add downtime.
 *
 * GET /ready (READINESS):  "Can I serve real traffic right now?"  Checks Postgres + Redis.
 *   If it fails, a load balancer STOPS SENDING TRAFFIC here until it recovers. No restart.
 */
export const healthRoutes: FastifyPluginAsyncZod<HealthRoutesOptions> = async (app, opts) => {
  const timeoutMs = opts.timeoutMs ?? 2_000;

  app.get('/health', { schema: { response: { 200: healthResponse } } }, async () => ({
    status: 'ok' as const,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  }));

  app.get(
    '/ready',
    { schema: { response: { 200: readyResponse, 503: readyResponse } } },
    async (request, reply) => {
      const names = Object.keys(opts.checks);
      const results = await Promise.allSettled(
        names.map((name) => withTimeout(opts.checks[name]!(), timeoutMs)),
      );

      const checks: Record<string, 'ok' | 'error'> = {};
      results.forEach((result, i) => {
        const name = names[i]!;
        checks[name] = result.status === 'fulfilled' ? 'ok' : 'error';
        if (result.status === 'rejected') {
          // Details go to the log only. The response just says which dependency failed.
          request.log.warn({ check: name, err: String(result.reason) }, 'Readiness check failed');
        }
      });

      const ready = Object.values(checks).every((c) => c === 'ok');
      return reply.status(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready', checks });
    },
  );
};
