import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

/**
 * One error shape for the whole API, so the frontend (and later the MCP server)
 * can handle failures uniformly:
 *
 *   { "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    // 1. Request failed a Zod schema (body, query, params, headers).
    if (hasZodFastifySchemaValidationErrors(error)) {
      const body: ApiErrorBody = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.validation.map((v) => ({
            // instancePath is JSON-pointer style, e.g. "/query" for body.query
            path: v.instancePath,
            message: v.message,
          })),
        },
      };
      return reply.status(400).send(body);
    }

    const err = error as { statusCode?: number; code?: string; message?: string };
    const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;

    // 2. Unexpected errors: log the details server-side and return a generic message.
    //    Internal messages can leak stack info, SQL, or file paths.
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled error');
      return reply.status(statusCode).send({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      } satisfies ApiErrorBody);
    }

    // 3. Expected client errors thrown by Fastify or our code (e.g. 413 payload too large).
    return reply.status(statusCode).send({
      error: { code: err.code ?? 'CLIENT_ERROR', message: err.message ?? 'Bad request' },
    } satisfies ApiErrorBody);
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
    } satisfies ApiErrorBody);
  });
}
