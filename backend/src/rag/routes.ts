import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../db/pool.js';
import type { Embedder } from '../embeddings/embedder.js';
import { AppError } from '../errors.js';
import type { ChatModel } from '../llm/chat-model.js';
import type { ConversationStore } from '../memory/store.js';
import { search } from '../search/search.js';
import { chatTurn, type ChatServiceDeps } from './chat-service.js';

export const chatBodySchema = z.object({
  // Input limit (guardrail): bounds prompt size and cost, and blocks pasting whole documents.
  question: z.string().trim().min(1, 'Question must not be empty').max(1000),
  topK: z.int().min(1).max(10).default(5),
  // Omit for a new conversation; send back the id from the previous answer for follow-ups.
  conversationId: z.uuid().optional(),
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
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  conversationId: z.uuid(),
  standaloneQuestion: z.string(),
});

/** Keeps idle connections open through proxies/load balancers (AWS ALB idle timeout: 60s). */
const HEARTBEAT_MS = 15_000;

export interface ChatRoutesOptions {
  db: Db;
  embedder: Embedder;
  chatModel: ChatModel;
  store: ConversationStore;
  conversationTokenBudget: number;
}

export const chatRoutes: FastifyPluginAsyncZod<ChatRoutesOptions> = async (
  app,
  { db, embedder, chatModel, store, conversationTokenBudget },
) => {
  const serviceDeps = (log: FastifyBaseLogger): ChatServiceDeps => ({
    retrieve: (q, k) => search({ db, embedder, log }, q, { topK: k, mode: 'hybrid' }),
    chatModel,
    store,
    log,
    conversationTokenBudget,
  });

  /**
   * POST /chat  { question, topK?, conversationId? }  →  the complete answer as one JSON response.
   *   200 answer with citations, or a refusal (answerable: false) | 400 validation
   *   429 CONVERSATION_BUDGET_EXCEEDED | 502 CHAT_FAILED / CHAT_INVALID_RESPONSE | 503 CHAT_NOT_CONFIGURED
   */
  app.post(
    '/chat',
    { schema: { body: chatBodySchema, response: { 200: chatResponseSchema } } },
    async (request) => chatTurn(serviceDeps(request.log), request.body),
  );

  /** DELETE /conversations/:id  →  204. Forget a conversation now instead of waiting for the TTL. */
  app.delete(
    '/conversations/:id',
    { schema: { params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      await store.clear(request.params.id);
      return reply.status(204).send();
    },
  );

  /**
   * POST /chat/stream  { question, topK?, conversationId? }  →  Server-Sent Events:
   *
   *   event: meta    data: {model, promptVersion, retrieval, warnings,
   *                         conversationId, standaloneQuestion}           (after retrieval)
   *   event: delta   data: {text}                                        (many, answer preview)
   *   event: done    data: <same body as POST /chat>                     (authoritative)
   *   event: error   data: {code, message}                               (instead of done)
   *
   * Validation errors (400) are normal JSON responses: they happen before the stream starts.
   * After that the status is already 200, so failures arrive as an `error` event.
   */
  app.post('/chat/stream', { schema: { body: chatBodySchema } }, async (request, reply) => {
    const res = reply.raw;

    // If the client disconnects (Stop button, closed tab), abort the LLM call:
    // nobody will read the rest, so don't pay for it.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    // From here on we write the HTTP response ourselves. hijack() tells Fastify not to
    // send anything, so headers set by plugins (CORS) must be copied over explicitly.
    reply.hijack();
    res.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string | number | string[]>),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // tell nginx-style proxies not to buffer the stream
    });

    const send = (event: string, data: unknown) => {
      if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => !res.destroyed && res.write(': ping\n\n'), HEARTBEAT_MS);

    try {
      const answer = await chatTurn(serviceDeps(request.log), request.body, {
        signal: controller.signal,
        onEvent: ({ type, ...data }) => send(type, data),
      });
      send('done', answer);
    } catch (err) {
      if (controller.signal.aborted) {
        request.log.info('Chat stream cancelled by client');
      } else if (err instanceof AppError) {
        send('error', { code: err.code, message: err.message });
      } else {
        request.log.error({ err }, 'Chat stream failed');
        send('error', { code: 'INTERNAL_ERROR', message: 'Something went wrong' });
      }
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });
};
