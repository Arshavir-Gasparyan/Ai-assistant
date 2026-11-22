import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { toPgVector } from '../../src/embeddings/embedder.js';
import { createFakeEmbedder } from '../../src/embeddings/fake-embedder.js';
import { createEmbedder } from '../../src/embeddings/index.js';
import { ingestDocument } from '../../src/ingestion/ingest.js';
import { makePdf } from '../fixtures/make-pdf.js';
import { fakeDeps, testEnv } from '../helpers.js';
import { testDatabaseUrl } from './test-db.js';

/** Build a multipart/form-data body by hand: this is all a browser's FormData does. */
function multipart(filename: string, content: string | Buffer, field = 'file') {
  const boundary = '----test-boundary-7MA4YWxkTrZu0gW';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, Buffer.isBuffer(content) ? content : Buffer.from(content), tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const HANDBOOK_V1 = `# Leave
## Vacation
Employees receive 25 days of paid vacation per year.
## Sick leave
Sick leave requires a doctor's note after 3 days.`;

const HANDBOOK_V2 = HANDBOOK_V1.replace('25 days', '30 days');

describe('documents API (real PostgreSQL)', () => {
  let app: App;
  let db: pg.Pool;

  const upload = (filename: string, content: string | Buffer) =>
    app.inject({ method: 'POST', url: '/documents', ...multipart(filename, content) });

  beforeAll(async () => {
    const { testUrl } = testDatabaseUrl();
    db = new pg.Pool({ connectionString: testUrl });
    const deps = fakeDeps();
    app = buildApp(testEnv({ DATABASE_URL: testUrl, MAX_UPLOAD_BYTES: '5000' }), { ...deps, db });
    await app.ready();
  });

  beforeEach(async () => {
    await db.query('TRUNCATE documents CASCADE');
  });

  afterAll(async () => {
    await app.close();
    await db.end();
  });

  describe('POST /documents', () => {
    it('ingests Markdown: stores the document and its chunks with heading paths', async () => {
      const res = await upload('handbook.md', HANDBOOK_V1);
      expect(res.statusCode).toBe(201);
      const { outcome, document } = res.json();
      expect(outcome).toBe('created');
      expect(document).toMatchObject({ filename: 'handbook.md', kind: 'markdown', status: 'ready', chunkCount: 2 });

      const { rows } = await db.query('SELECT heading, content FROM chunks ORDER BY chunk_index');
      expect(rows).toEqual([
        { heading: 'Leave > Vacation', content: 'Employees receive 25 days of paid vacation per year.' },
        { heading: 'Leave > Sick leave', content: "Sick leave requires a doctor's note after 3 days." },
      ]);
    });

    it('is idempotent: re-uploading identical content changes nothing', async () => {
      const first = (await upload('handbook.md', HANDBOOK_V1)).json();
      const second = await upload('handbook.md', HANDBOOK_V1);
      expect(second.statusCode).toBe(200);
      expect(second.json().outcome).toBe('unchanged');
      expect(second.json().document).toEqual(first.document); // same id, same updatedAt
      const { rows } = await db.query('SELECT count(*)::int AS n FROM chunks');
      expect(rows[0].n).toBe(2);
    });

    it('replaces old chunks when a file with the same name changes', async () => {
      const first = (await upload('handbook.md', HANDBOOK_V1)).json();
      const res = await upload('handbook.md', HANDBOOK_V2);
      expect(res.json().outcome).toBe('replaced');
      expect(res.json().document.id).toBe(first.document.id); // stable id across versions

      const { rows } = await db.query('SELECT content FROM chunks');
      expect(rows).toHaveLength(2); // old chunks are gone, not duplicated
      expect(rows.map((r) => r.content).join(' ')).toContain('30 days');
      expect(rows.map((r) => r.content).join(' ')).not.toContain('25 days');
    });

    it('ingests a PDF with page numbers on each chunk', async () => {
      const pdf = makePdf([['Expenses must be filed within 30 days.'], ['Meals are capped at 50 EUR.']]);
      const res = await upload('expenses.pdf', pdf);
      expect(res.statusCode).toBe(201);
      expect(res.json().document).toMatchObject({ kind: 'pdf', pageCount: 2, chunkCount: 2 });
      const { rows } = await db.query('SELECT page_number FROM chunks ORDER BY chunk_index');
      expect(rows.map((r) => r.page_number)).toEqual([1, 2]);
    });

    it('rejects unsupported file types with 415', async () => {
      const res = await upload('script.exe', 'MZ...');
      expect(res.statusCode).toBe(415);
      expect(res.json().error.code).toBe('UNSUPPORTED_FILE_TYPE');
    });

    it('rejects files over the size limit with 413', async () => {
      const res = await upload('big.md', 'x'.repeat(6000));
      expect(res.statusCode).toBe(413);
      const { rows } = await db.query('SELECT count(*)::int AS n FROM documents');
      expect(rows[0].n).toBe(0);
    });

    it('rejects a non-multipart request with 415', async () => {
      const res = await app.inject({ method: 'POST', url: '/documents', payload: { file: 'x' } });
      expect(res.statusCode).toBe(415);
    });

    it('rejects a request without a "file" field with 400', async () => {
      const res = await app.inject({ method: 'POST', url: '/documents', ...multipart('a.md', '# A', 'other') });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET / DELETE', () => {
    it('lists documents', async () => {
      await upload('a.md', '# A\nalpha');
      await upload('b.md', '# B\nbeta');
      const res = await app.inject({ method: 'GET', url: '/documents' });
      expect(res.json().documents.map((d: { filename: string }) => d.filename).sort()).toEqual(['a.md', 'b.md']);
    });

    it('returns one document with its chunks in order', async () => {
      const { document } = (await upload('handbook.md', HANDBOOK_V1)).json();
      const res = await app.inject({ method: 'GET', url: `/documents/${document.id}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().chunks.map((c: { chunkIndex: number }) => c.chunkIndex)).toEqual([0, 1]);
    });

    it('404s for an unknown id and 400s for a malformed one', async () => {
      const unknown = await app.inject({ method: 'GET', url: '/documents/00000000-0000-4000-8000-000000000000' });
      expect(unknown.statusCode).toBe(404);
      const malformed = await app.inject({ method: 'GET', url: '/documents/not-a-uuid' });
      expect(malformed.statusCode).toBe(400);
    });

    it('deletes a document and cascades to its chunks', async () => {
      const { document } = (await upload('handbook.md', HANDBOOK_V1)).json();
      const del = await app.inject({ method: 'DELETE', url: `/documents/${document.id}` });
      expect(del.statusCode).toBe(204);
      const { rows } = await db.query('SELECT count(*)::int AS n FROM chunks');
      expect(rows[0].n).toBe(0);
      const again = await app.inject({ method: 'DELETE', url: `/documents/${document.id}` });
      expect(again.statusCode).toBe(404);
    });
  });
  describe('embeddings (Milestone 6)', () => {
    it('stores one 1536-dimensional vector per chunk and records the model', async () => {
      const { document } = (await upload('handbook.md', HANDBOOK_V1)).json();
      expect(document.embeddingModel).toBe('fake-hashing-v1');
      const { rows } = await db.query('SELECT vector_dims(embedding) AS dims FROM chunks');
      expect(rows.map((r) => r.dims)).toEqual([1536, 1536]);
    });

    it('re-embeds an unchanged file when the embedding model changes', async () => {
      const log = fakeDeps().log;
      const data = Buffer.from(HANDBOOK_V1);
      await ingestDocument(db, createFakeEmbedder('fake-hashing-v1'), log, { filename: 'h.md', data });
      const same = await ingestDocument(db, createFakeEmbedder('fake-hashing-v1'), log, { filename: 'h.md', data });
      const newModel = await ingestDocument(db, createFakeEmbedder('fake-hashing-v2'), log, { filename: 'h.md', data });
      expect(same.outcome).toBe('unchanged');
      expect(newModel.outcome).toBe('replaced');
      expect(newModel.document.embeddingModel).toBe('fake-hashing-v2');
    });

    it('finds the nearest chunk to a question with pgvector (<=> cosine distance)', async () => {
      await upload('handbook.md', HANDBOOK_V1);
      const [question] = await createFakeEmbedder().embed(["Do I need a doctor's note when sick?"]);
      const { rows } = await db.query(
        `SELECT heading, 1 - (embedding <=> $1::vector) AS similarity
           FROM chunks ORDER BY embedding <=> $1::vector LIMIT 2`,
        [toPgVector(question!)],
      );
      expect(rows[0].heading).toBe('Leave > Sick leave');
      expect(rows[0].similarity).toBeGreaterThan(rows[1].similarity);
    });

    it('returns 503 and stores nothing when embeddings are not configured', async () => {
      const deps = fakeDeps();
      const noKey = createEmbedder({ EMBEDDING_PROVIDER: 'openai', OPENAI_API_KEY: undefined }, deps.log);
      const appWithoutKey = buildApp(testEnv(), { ...deps, db, embedder: noKey });
      const res = await appWithoutKey.inject({ method: 'POST', url: '/documents', ...multipart('a.md', '# A\ntext') });
      await appWithoutKey.close();
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('EMBEDDINGS_NOT_CONFIGURED');
      const { rows } = await db.query('SELECT count(*)::int AS n FROM documents');
      expect(rows[0].n).toBe(0);
    });
  });
});
