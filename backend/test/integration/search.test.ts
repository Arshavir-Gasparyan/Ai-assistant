import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { createFakeEmbedder } from '../../src/embeddings/fake-embedder.js';
import { createEmbedder } from '../../src/embeddings/index.js';
import { ingestDocument } from '../../src/ingestion/ingest.js';
import { fakeDeps, testEnv } from '../helpers.js';
import { testDatabaseUrl } from './test-db.js';

/**
 * Uses the FAKE embedder (word hashing), so "vector" search here is lexical too.
 * These tests check the plumbing (SQL, fusion, fallbacks), not semantic quality;
 * that is what the evaluation in Milestone 15 measures with real embeddings.
 */
const HANDBOOK = `# Handbook
## Vacation
Full-time employees receive 25 days of paid vacation per year.
### Carry-over
Up to 5 unused vacation days can be carried over into the next year.
## Remote work
Employees may work remotely up to 3 days per week with manager approval.`;

const SECURITY = `# IT Security Policy
## Passwords
Passwords must be at least 14 characters long and must never be shared.
## Laptops
Report a lost laptop to the security team within 24 hours.`;

describe('POST /search (real PostgreSQL)', () => {
  let app: App;
  let db: pg.Pool;
  const deps = fakeDeps();

  const search = (body: object, target = () => app) =>
    target().inject({ method: 'POST', url: '/search', payload: body });

  beforeAll(async () => {
    const { testUrl } = testDatabaseUrl();
    db = new pg.Pool({ connectionString: testUrl });
    await db.query('TRUNCATE documents CASCADE');
    for (const [filename, text] of [['handbook.md', HANDBOOK], ['security.md', SECURITY]] as const) {
      await ingestDocument(db, deps.embedder, deps.log, { filename, data: Buffer.from(text) });
    }
    app = buildApp(testEnv({ DATABASE_URL: testUrl }), { ...deps, db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it('hybrid: returns the best chunk first with citation fields and both ranks', async () => {
    const res = await search({ query: 'How many vacation days can be carried over?' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.modeUsed).toBe('hybrid');
    expect(body.warnings).toEqual([]);

    const top = body.results[0];
    expect(top.heading).toBe('Handbook > Vacation > Carry-over');
    expect(top.filename).toBe('handbook.md');
    expect(top.ranks.vector).toBeTypeOf('number');
    expect(top.ranks.keyword).toBeTypeOf('number');
    expect(top.similarity).toBeGreaterThan(0);
  });

  it('keyword: stemming matches other word forms ("carrying" finds "carried")', async () => {
    const body = (await search({ query: 'carrying', mode: 'keyword' })).json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].content).toContain('carried over');
    expect(body.results[0].ranks).toEqual({ vector: null, keyword: 1 });
    expect(body.results[0].similarity).toBeNull();
  });

  it('keyword: a heading match counts (heading words are indexed with weight A)', async () => {
    const body = (await search({ query: 'laptops', mode: 'keyword' })).json();
    expect(body.results[0].heading).toBe('IT Security Policy > Laptops');
  });

  it('keyword: OR semantics: a full question matches even if some words appear nowhere', async () => {
    // "many", "minimum" and "length" are in no chunk; with AND this would return nothing.
    const body = (await search({ query: 'How many characters is the minimum password length?', mode: 'keyword' })).json();
    expect(body.results[0].heading).toBe('IT Security Policy > Passwords');
  });

  it('keyword: chunks matching more query words rank higher', async () => {
    const body = (await search({ query: 'remote work days per week', mode: 'keyword' })).json();
    expect(body.results[0].heading).toBe('Handbook > Remote work');
    expect(body.results.length).toBeGreaterThan(1); // other chunks mention "days" too
  });

  it('keyword: a query of only stop words matches nothing (and does not error)', async () => {
    const body = (await search({ query: 'how is the', mode: 'keyword' })).json();
    expect(body.results).toEqual([]);
  });

  it('keyword: no match → empty results (not an error)', async () => {
    const body = (await search({ query: 'kubernetes', mode: 'keyword' })).json();
    expect(body.results).toEqual([]);
  });

  it('vector: only compares against chunks embedded with the same model', async () => {
    const other = createFakeEmbedder('another-model');
    const otherApp = buildApp(testEnv(), { ...deps, db, embedder: other });
    const body = (await search({ query: 'vacation days', mode: 'vector' }, () => otherApp)).json();
    expect(body.results).toEqual([]);
    await otherApp.close();
  });

  it('respects topK', async () => {
    const body = (await search({ query: 'days', topK: 2 })).json();
    expect(body.results).toHaveLength(2);
  });

  describe('without an embedding provider (no OPENAI_API_KEY)', () => {
    const noKey = () =>
      buildApp(testEnv(), {
        ...deps,
        db,
        embedder: createEmbedder({ EMBEDDING_PROVIDER: 'openai', OPENAI_API_KEY: undefined }, deps.log),
      });

    it('hybrid falls back to keyword search and says so', async () => {
      const a = noKey();
      const body = (await search({ query: 'password length' }, () => a)).json();
      expect(body.modeUsed).toBe('keyword');
      expect(body.warnings).toHaveLength(1);
      expect(body.results[0].heading).toContain('Passwords');
      await a.close();
    });

    it('explicit mode=vector fails with 503', async () => {
      const a = noKey();
      const res = await search({ query: 'password length', mode: 'vector' }, () => a);
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('EMBEDDINGS_NOT_CONFIGURED');
      await a.close();
    });
  });
});
