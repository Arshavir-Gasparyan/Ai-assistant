import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../db/pool.js';
import type { Embedder } from '../embeddings/embedder.js';
import type { ChatModel } from '../llm/chat-model.js';
import { search } from '../search/search.js';
import { answerQuestion } from './answer.js';

export const chatBodySchema = z.object({
  // Input limit (guardrail): bounds prompt size and cost, and blocks pasting whole documents.
  question: z.string().trim().min(1, 'Question must not be empty').max(1000),
  topK: z.int().min(1).max(10).default(5),
});

const citationSchema = z.object({
  n: z.number(),
  chunkId: z.uuid(),
  documentId: z.uuid(),
  filename: z.string(),
  heading: z.string().nullable(),
  pageNumber: z.number().nullable(),
  snippet: z.string(),
});

const chatResponseSchema = z.object({
  answer: z.string(),
  answerable: z.boolean(),
  refusalReason: z.enum(['no_sources', 'not_in_sources', 'no_valid_citations']).nullable(),
  citations: z.array(citationSchema),
  model: z.string(),
  promptVersion: z.string(),
  retrieval: z.object({ modeUsed: z.enum(['hybrid', 'vector', 'keyword']), sources: z.number() }),
  warnings: z.array(z.string()),
});

export const chatRoutes: FastifyPluginAsyncZod<{ db: Db; embedder: Embedder; chatModel: ChatModel }> = async (
  app,
  { db, embedder, chatModel },
) => {
  /**
   * POST /chat  { question, topK? }
   *   200 answer with citations, or a refusal (answerable: false) | 400 validation
   *   502 CHAT_FAILED / CHAT_INVALID_RESPONSE | 503 CHAT_NOT_CONFIGURED
   * Streaming arrives in Milestone 9, conversation memory in Milestone 10.
   */
  app.post(
    '/chat',
    { schema: { body: chatBodySchema, response: { 200: chatResponseSchema } } },
    async (request) => {
      const { question, topK } = request.body;
      return answerQuestion(
        {
          retrieve: (q, k) => search({ db, embedder, log: request.log }, q, { topK: k, mode: 'hybrid' }),
          chatModel,
          log: request.log,
        },
        question,
        topK,
      );
    },
  );
};
