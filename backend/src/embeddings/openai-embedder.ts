import type { FastifyBaseLogger } from 'fastify';
import OpenAI from 'openai';
import { AppError } from '../errors.js';
import { logLlmCall } from '../llm/usage.js';
import { EMBEDDING_DIMENSIONS, type Embedder } from './embedder.js';

const MODEL = 'text-embedding-3-small';
/** Texts per API request. The API allows up to 2048 inputs; 100 keeps requests small. */
const BATCH_SIZE = 100;

/**
 * @param clientOptions overrides for tests, e.g. a fake `fetch` that plays the OpenAI server,
 *        or `maxRetries: 0`. Production code passes nothing.
 */
export function createOpenAIEmbedder(
  apiKey: string,
  log: FastifyBaseLogger,
  clientOptions: Partial<ConstructorParameters<typeof OpenAI>[0]> = {},
): Embedder {
  // The SDK retries 429 (rate limit) and 5xx errors with exponential backoff.
  const client = new OpenAI({ apiKey, maxRetries: 3, timeout: 30_000, ...clientOptions });

  return {
    model: MODEL,
    dimensions: EMBEDDING_DIMENSIONS,

    async embed(texts) {
      const vectors: number[][] = [];

      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const startedAt = performance.now();

        let response: OpenAI.CreateEmbeddingResponse;
        try {
          response = await client.embeddings.create({ model: MODEL, input: batch, encoding_format: 'float' });
        } catch (err) {
          // Log status + error code for us, NOT the provider's message: on a 401 it echoes
          // part of the API key. The client gets a generic error.
          const details =
            err instanceof OpenAI.APIError
              ? { status: err.status, code: err.code, type: err.type }
              : { error: (err as Error).name };
          log.error(details, 'Embedding request failed');
          throw new AppError(502, 'EMBEDDING_FAILED', 'Could not create embeddings. Try again later.');
        }

        logLlmCall(log, {
          provider: 'openai',
          model: MODEL,
          operation: 'embedding',
          inputTokens: response.usage.prompt_tokens,
          latencyMs: performance.now() - startedAt,
          items: batch.length,
        });

        // Don't assume order: place each vector by the index the API returns.
        const ordered = [...response.data].sort((a, b) => a.index - b.index);
        if (ordered.length !== batch.length || ordered.some((d) => d.embedding.length !== EMBEDDING_DIMENSIONS)) {
          throw new AppError(502, 'EMBEDDING_FAILED', 'Embedding provider returned an unexpected response');
        }
        vectors.push(...ordered.map((d) => d.embedding));
      }

      return vectors;
    },
  };
}
