import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

const healthResponse = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number(),
  timestamp: z.string(),
});

/**
 * Liveness check: "is the process up and serving HTTP?"
 * Docker Compose healthchecks (M4) and later AWS load balancers call this.
 * In M4 we add a readiness check that also verifies Postgres and Redis.
 */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    { schema: { response: { 200: healthResponse } } },
    async () => ({
      status: 'ok' as const,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    }),
  );
};
