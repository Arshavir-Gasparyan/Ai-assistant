import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../db/pool.js';
import type { Embedder } from '../embeddings/embedder.js';
import { search } from './search.js';

const modeSchema = z.enum(['hybrid', 'vector', 'keyword']);

export const searchBodySchema = z.object({
  // Input limit (guardrail): a search query is a sentence, not a document.
  query: z.string().trim().min(1, 'Query must not be empty').max(500),
  topK: z.int().min(1).max(20).default(5),
  mode: modeSchema.default('hybrid'),
});

const resultSchema = z.object({
  chunkId: z.uuid(),
  documentId: z.uuid(),
  filename: z.string(),
  heading: z.string().nullable(),
  pageNumber: z.number().nullable(),
  content: z.string(),
  score: z.number(),
  ranks: z.object({ vector: z.number().nullable(), keyword: z.number().nullable() }),
  similarity: z.number().nullable(),
});

export const searchRoutes: FastifyPluginAsyncZod<{
  db: Db;
  embedder: Embedder;
  log: FastifyBaseLogger;
}> = async (app, deps) => {
  /**
   * POST /search  { query, topK?, mode? }
   *   200 { query, modeUsed, results[], warnings[] } | 400 validation
   *   502/503 only for mode=vector (hybrid falls back to keyword search)
   */
  app.post(
    '/search',
    {
      schema: {
        body: searchBodySchema,
        response: {
          200: z.object({
            query: z.string(),
            modeUsed: modeSchema,
            results: z.array(resultSchema),
            warnings: z.array(z.string()),
          }),
        },
      },
    },
    async (request) => {
      const { query, topK, mode } = request.body;
      const response = await search({ ...deps, log: request.log }, query, { topK, mode });
      return { query, ...response };
    },
  );
};
