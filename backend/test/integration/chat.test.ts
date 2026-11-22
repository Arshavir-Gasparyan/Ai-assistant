import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { createEmbedder } from '../../src/embeddings/index.js';
import { createChatModel } from '../../src/llm/index.js';
import { ingestDocument } from '../../src/ingestion/ingest.js';
import { REFUSAL_MESSAGE } from '../../src/rag/answer.js';
import { fakeDeps, testEnv } from '../helpers.js';
import { testDatabaseUrl } from './test-db.js';

/**
 * End-to-end RAG over real PostgreSQL with the FAKE embedder and FAKE chat model:
 * checks retrieval → prompt → structured answer → citations wiring, not answer quality.
 */
const HANDBOOK = `# Handbook
## Vacation
Full-time employees receive 25 days of paid vacation per year.
### Carry-over
Up to 5 unused vacation days can be carried over into the next year.`;

describe('POST /chat (real PostgreSQL)', () => {
  let app: App;
  let db: pg.Pool;
  const deps = fakeDeps();
  const ask = (payload: object, target = () => app) => target().inject({ method: 'POST', url: '/chat', payload });

  beforeAll(async () => {
    const { testUrl } = testDatabaseUrl();
    db = new pg.Pool({ connectionString: testUrl });
    await db.query('TRUNCATE documents CASCADE');
    await ingestDocument(db, deps.embedder, deps.log, { filename: 'handbook.md', data: Buffer.from(HANDBOOK) });
    app = buildApp(testEnv(), { ...deps, db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it('answers with a citation that points to the real chunk', async () => {
    const res = await ask({ question: 'How many unused vacation days can be carried over?' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body).toMatchObject({ answerable: true, refusalReason: null, promptVersion: 'rag-answer@v1', model: 'fake-extractive-v1' });
    expect(body.answer).toMatch(/carried over.*\[\d\]/);
    const [citation] = body.citations;
    expect(citation).toMatchObject({ filename: 'handbook.md', heading: 'Handbook > Vacation > Carry-over' });

    // The citation's chunkId really exists and contains the cited text.
    const { rows } = await db.query('SELECT content FROM chunks WHERE id = $1', [citation.chunkId]);
    expect(rows[0].content).toContain('carried over');
  });

  it('refuses when nothing relevant is in the documents', async () => {
    const body = (await ask({ question: 'Kubernetes cluster upgrade procedure' })).json();
    expect(body).toMatchObject({ answer: REFUSAL_MESSAGE, answerable: false, citations: [] });
    expect(['no_sources', 'not_in_sources']).toContain(body.refusalReason);
  });

  it('still answers without an embedding key (keyword-only retrieval) and says so', async () => {
    const noKey = buildApp(testEnv(), {
      ...deps,
      db,
      embedder: createEmbedder({ EMBEDDING_PROVIDER: 'openai', OPENAI_API_KEY: undefined }, deps.log),
    });
    const body = (await ask({ question: 'How many vacation days per year?' }, () => noKey)).json();
    expect(body.answerable).toBe(true);
    expect(body.retrieval.modeUsed).toBe('keyword');
    expect(body.warnings).toHaveLength(1);
    await noKey.close();
  });

  it('503 when no chat model is configured', async () => {
    const noChat = buildApp(testEnv(), {
      ...deps,
      db,
      chatModel: createChatModel({ CHAT_PROVIDER: 'openai', CHAT_MODEL: 'gpt-4.1-mini', OPENAI_API_KEY: undefined }, deps.log),
    });
    const res = await ask({ question: 'How many vacation days?' }, () => noChat);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('CHAT_NOT_CONFIGURED');
    await noChat.close();
  });
});
