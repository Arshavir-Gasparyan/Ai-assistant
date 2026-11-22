import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../config/env.js';
import { AppError } from '../errors.js';
import { EMBEDDING_DIMENSIONS, type Embedder } from './embedder.js';
import { createFakeEmbedder } from './fake-embedder.js';
import { createOpenAIEmbedder } from './openai-embedder.js';

export type { Embedder } from './embedder.js';

/** Pick the embedder from config. Called once at startup. */
export function createEmbedder(
  env: Pick<Env, 'EMBEDDING_PROVIDER' | 'OPENAI_API_KEY'>,
  log: FastifyBaseLogger,
): Embedder {
  if (env.EMBEDDING_PROVIDER === 'fake') {
    log.warn('EMBEDDING_PROVIDER=fake: using word-hashing vectors (offline, NOT semantic)');
    return createFakeEmbedder();
  }
  if (env.OPENAI_API_KEY) return createOpenAIEmbedder(env.OPENAI_API_KEY, log);

  // No key: keep the API running (health, listing, deleting all work), but fail
  // ingestion with a clear message instead of crashing at boot.
  log.warn('OPENAI_API_KEY is not set: document ingestion will be unavailable');
  return {
    model: 'text-embedding-3-small',
    dimensions: EMBEDDING_DIMENSIONS,
    async embed() {
      throw new AppError(
        503,
        'EMBEDDINGS_NOT_CONFIGURED',
        'Embeddings are not configured. Set OPENAI_API_KEY, or EMBEDDING_PROVIDER=fake for offline testing.',
      );
    },
  };
}
