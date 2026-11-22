import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { cosineSimilarity, EMBEDDING_DIMENSIONS, embeddingInput, toPgVector } from '../src/embeddings/embedder.js';
import { createFakeEmbedder } from '../src/embeddings/fake-embedder.js';
import { createEmbedder } from '../src/embeddings/index.js';
import { createOpenAIEmbedder } from '../src/embeddings/openai-embedder.js';
import { estimateCostUsd } from '../src/llm/usage.js';
import { createLogger } from '../src/logger.js';

const silent = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });

describe('vector helpers', () => {
  it('cosine similarity: same direction = 1, perpendicular = 0, opposite = -1', () => {
    expect(cosineSimilarity([1, 1], [2, 2])).toBeCloseTo(1); // length doesn't matter, direction does
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('prepends the heading path to the text that gets embedded', () => {
    expect(embeddingInput({ heading: 'Leave > Vacation', content: 'Up to 5 days.' })).toBe('Leave > Vacation\n\nUp to 5 days.');
    expect(embeddingInput({ heading: null, content: 'Page text.' })).toBe('Page text.');
  });

  it('formats vectors the way pgvector expects', () => {
    expect(toPgVector([0.5, -1, 2])).toBe('[0.5,-1,2]');
  });
});

describe('fake embedder', () => {
  const embedder = createFakeEmbedder();

  it('is deterministic and returns unit-length 1536-d vectors', async () => {
    const [a, b] = await embedder.embed(['vacation days', 'vacation days']);
    expect(a).toEqual(b);
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(Math.hypot(...a!)).toBeCloseTo(1);
  });

  it('scores texts that share words higher (lexical, not semantic)', async () => {
    const [q, vacation, password] = await embedder.embed([
      'how many vacation days',
      'employees receive 25 vacation days',
      'passwords must be 14 characters',
    ]);
    expect(cosineSimilarity(q!, vacation!)).toBeGreaterThan(cosineSimilarity(q!, password!));
  });
});

describe('cost estimation', () => {
  it('prices text-embedding-3-small at $0.02 per 1M tokens', () => {
    expect(estimateCostUsd('text-embedding-3-small', 1_000_000)).toBeCloseTo(0.02);
    expect(estimateCostUsd('text-embedding-3-small', 2_000)).toBeCloseTo(0.00004);
  });

  it('returns null for unknown models instead of guessing', () => {
    expect(estimateCostUsd('some-local-model', 1000)).toBeNull();
  });
});

/**
 * Boundary tests for the OpenAI embedder: a fake `fetch` plays the OpenAI API, so these
 * tests run offline, cost nothing, and can simulate failures that are hard to trigger for real.
 */
describe('OpenAI embedder (mocked HTTP)', () => {
  type Body = { model: string; input: string[] };

  function fakeOpenAI(handler: (body: Body) => Response | Promise<Response>) {
    return vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      handler(JSON.parse(String(init?.body)) as Body),
    );
  }

  const okResponse = (body: Body, opts: { shuffle?: boolean; dims?: number } = {}) => {
    const data = body.input.map((text, index) => ({
      object: 'embedding',
      index,
      // Encode the text length in the vector so we can check ordering.
      embedding: [text.length, ...new Array((opts.dims ?? EMBEDDING_DIMENSIONS) - 1).fill(0)],
    }));
    if (opts.shuffle) data.reverse();
    return Response.json({
      object: 'list',
      model: body.model,
      data,
      usage: { prompt_tokens: body.input.length * 10, total_tokens: body.input.length * 10 },
    });
  };

  const make = (fetch: ReturnType<typeof fakeOpenAI>, log = silent) =>
    createOpenAIEmbedder('sk-test-0000000000000000000000', log, { fetch, maxRetries: 0 });

  it('sends texts in batches of 100 and returns vectors in input order', async () => {
    const fetch = fakeOpenAI((body) => okResponse(body, { shuffle: true }));
    const texts = Array.from({ length: 250 }, (_, i) => 'x'.repeat(i + 1));

    const vectors = await make(fetch).embed(texts);

    expect(fetch).toHaveBeenCalledTimes(3); // 100 + 100 + 50
    expect(vectors).toHaveLength(250);
    // Despite the shuffled responses, vector i belongs to text i.
    expect(vectors.map((v) => v[0])).toEqual(texts.map((t) => t.length));
  });

  it('requests text-embedding-3-small', async () => {
    const fetch = fakeOpenAI((body) => okResponse(body));
    await make(fetch).embed(['hello']);
    expect((JSON.parse(String(fetch.mock.calls[0]![1]!.body)) as Body).model).toBe('text-embedding-3-small');
  });

  it('logs every call with tokens, latency and cost, but never the text', async () => {
    const info = vi.fn();
    const log = { ...silent, info, child: () => log } as unknown as typeof silent;
    await make(fakeOpenAI((body) => okResponse(body)), log).embed(['secret document text', 'more']);

    const [fields, msg] = info.mock.calls[0]!;
    expect(msg).toBe('LLM call');
    expect(fields.llm).toMatchObject({ provider: 'openai', operation: 'embedding', inputTokens: 20, items: 2 });
    expect(fields.llm.costUsd).toBeCloseTo(20 * 0.02 / 1_000_000);
    expect(JSON.stringify(info.mock.calls)).not.toContain('secret document text');
  });

  it('turns provider errors into a generic 502 and never logs the key fragment', async () => {
    const error = vi.fn();
    const log = { ...silent, error, child: () => log } as unknown as typeof silent;
    const fetch = fakeOpenAI(() =>
      Response.json(
        { error: { message: 'Incorrect API key provided: sk-abc***xyz', type: 'invalid_request_error', code: 'invalid_api_key' } },
        { status: 401 },
      ),
    );
    await expect(make(fetch, log).embed(['hi'])).rejects.toMatchObject({
      statusCode: 502,
      code: 'EMBEDDING_FAILED',
      message: expect.not.stringContaining('sk-abc'),
    });
    expect(error.mock.calls[0]![0]).toEqual({ status: 401, code: 'invalid_api_key', type: 'invalid_request_error' });
    expect(JSON.stringify(error.mock.calls)).not.toContain('sk-abc');
  });

  it('rejects vectors with the wrong number of dimensions', async () => {
    const fetch = fakeOpenAI((body) => okResponse(body, { dims: 768 }));
    await expect(make(fetch).embed(['hi'])).rejects.toMatchObject({ code: 'EMBEDDING_FAILED' });
  });
});

describe('createEmbedder', () => {
  const env = (o: Record<string, string>) =>
    loadEnv({ DATABASE_URL: 'postgresql://u:p@localhost/db', REDIS_URL: 'redis://localhost', ...o });

  it('treats an empty OPENAI_API_KEY as missing and fails ingestion with 503', async () => {
    const e = env({ OPENAI_API_KEY: '' });
    expect(e.OPENAI_API_KEY).toBeUndefined();
    await expect(createEmbedder(e, silent).embed(['x'])).rejects.toMatchObject({
      statusCode: 503,
      code: 'EMBEDDINGS_NOT_CONFIGURED',
    });
  });

  it('uses the fake embedder when EMBEDDING_PROVIDER=fake', () => {
    expect(createEmbedder(env({ EMBEDDING_PROVIDER: 'fake' }), silent).model).toBe('fake-hashing-v1');
  });

  it('uses OpenAI when a key is set', () => {
    expect(createEmbedder(env({ OPENAI_API_KEY: 'sk-test-0000000000000000000000' }), silent).model).toBe('text-embedding-3-small');
  });
});
