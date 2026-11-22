/**
 * Pure vector search over your ingested chunks, straight in SQL. A preview of what
 * POST /search does in Milestone 7 (which adds keyword search and rank fusion).
 *
 *   npm run embed:search -- "How many days can I carry over?"
 *
 * Needs: Postgres running (docker compose up -d postgres) and documents ingested with
 * the SAME embedding provider you use here. Vectors from different models aren't comparable.
 */
import pg from 'pg';
import { toPgVector } from '../src/embeddings/embedder.js';
import { createEmbedder } from '../src/embeddings/index.js';
import { createLogger } from '../src/logger.js';

const question = process.argv.slice(2).join(' ').trim();
if (!question) {
  console.error('Usage: npm run embed:search -- "your question"');
  process.exit(1);
}

const embedder = createEmbedder(
  {
    EMBEDDING_PROVIDER: (process.env.EMBEDDING_PROVIDER ?? 'openai') as 'openai' | 'fake',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || undefined,
  },
  createLogger({ NODE_ENV: 'production', LOG_LEVEL: 'warn' }),
);
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const { rows: models } = await db.query<{ embedding_model: string }>(
    'SELECT DISTINCT embedding_model FROM documents WHERE embedding_model IS NOT NULL',
  );
  if (!models.some((m) => m.embedding_model === embedder.model)) {
    console.error(
      `No documents embedded with "${embedder.model}" (found: ${models.map((m) => m.embedding_model).join(', ') || 'none'}).\n` +
        'Re-upload the documents with this provider first.',
    );
    process.exit(1);
  }

  const [vector] = await embedder.embed([question]);

  // <=> is pgvector's cosine DISTANCE (0 = identical direction). Similarity = 1 - distance.
  // ORDER BY embedding <=> $1 ... LIMIT k is exactly the query shape the HNSW index accelerates.
  const { rows } = await db.query<{
    filename: string;
    heading: string | null;
    page_number: number | null;
    content: string;
    similarity: number;
  }>(
    `SELECT d.filename, c.heading, c.page_number, c.content,
            1 - (c.embedding <=> $1::vector) AS similarity
       FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE d.embedding_model = $2
      ORDER BY c.embedding <=> $1::vector
      LIMIT 5`,
    [toPgVector(vector!), embedder.model],
  );

  console.log(`\nQuestion: "${question}"   (model: ${embedder.model})\n`);
  rows.forEach((r, i) => {
    const where = r.heading ?? (r.page_number ? `page ${r.page_number}` : '');
    console.log(`${i + 1}. similarity ${Number(r.similarity).toFixed(3)}  ${r.filename}  ›  ${where}`);
    console.log(`   ${r.content.replace(/\s+/g, ' ').slice(0, 140)}…\n`);
  });
} finally {
  await db.end();
}
