import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/pool.js';
import { toPgVector, type Embedder } from '../embeddings/embedder.js';
import { AppError } from '../errors.js';
import { reciprocalRankFusion } from './rrf.js';

export type SearchMode = 'hybrid' | 'vector' | 'keyword';

export interface SearchOptions {
  topK: number;
  mode: SearchMode;
}

export interface SearchResult {
  chunkId: string;
  documentId: string;
  filename: string;
  heading: string | null;
  pageNumber: number | null;
  content: string;
  /** RRF score: only meaningful for ordering, not as a "confidence". */
  score: number;
  ranks: { vector: number | null; keyword: number | null };
  /** Cosine similarity (1 = same meaning), when the vector search found this chunk. */
  similarity: number | null;
}

export interface SearchResponse {
  /** What actually ran. Hybrid falls back to 'keyword' if embeddings are unavailable. */
  modeUsed: SearchMode;
  results: SearchResult[];
  warnings: string[];
}

/** Each search fetches more candidates than topK, so fusion has something to merge. */
export const candidateCount = (topK: number) => Math.min(Math.max(topK * 4, 20), 50);

/** Vector search: nearest chunks by cosine distance. Uses the HNSW index. */
export async function vectorSearch(db: Db, vector: number[], model: string, limit: number) {
  // Only compare against chunks embedded by the SAME model: vectors from different
  // models live in different "spaces" and their distances are meaningless.
  const { rows } = await db.query<{ id: string; similarity: number }>(
    `SELECT c.id, 1 - (c.embedding <=> $1::vector) AS similarity
       FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE d.embedding_model = $2 AND d.status = 'ready' AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> $1::vector
      LIMIT $3`,
    [toPgVector(vector), model, limit],
  );
  return rows.map((r) => ({ id: r.id, similarity: Number(r.similarity) }));
}

/** Keyword search: Postgres full-text search over the generated search_tsv column (GIN index). */
export async function keywordSearch(db: Db, query: string, limit: number) {
  // OR semantics, built from plainto_tsquery (which never throws on odd input):
  //   'How many vacation days can be carried over?'
  //   plainto_tsquery  →  'mani' & 'vacat' & 'day' & 'carri'   (AND: needs EVERY word, so "many" kills it)
  //   & replaced by |  →  'mani' | 'vacat' | 'day' | 'carri'   (OR: any word matches)
  // People ask questions in full sentences, so AND finds almost nothing. With OR,
  // ts_rank_cd puts chunks matching MORE (and closer) query words first.
  // Lexemes are quoted in the tsquery text, so the replace can't touch their contents.
  const { rows } = await db.query<{ id: string }>(
    `WITH query AS (
       SELECT replace(plainto_tsquery('english', $1)::text, ' & ', ' | ')::tsquery AS q
     )
     SELECT c.id
       FROM query, chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE c.search_tsv @@ query.q AND d.status = 'ready'
      ORDER BY ts_rank_cd(c.search_tsv, query.q) DESC, c.id
      LIMIT $2`,
    [query, limit],
  );
  return rows.map((r) => r.id);
}

async function loadChunks(db: Db, ids: string[]) {
  const { rows } = await db.query<{
    id: string;
    document_id: string;
    filename: string;
    heading: string | null;
    page_number: number | null;
    content: string;
  }>(
    `SELECT c.id, c.document_id, d.filename, c.heading, c.page_number, c.content
       FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE c.id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

const EMBEDDING_UNAVAILABLE = new Set(['EMBEDDINGS_NOT_CONFIGURED', 'EMBEDDING_FAILED']);

/**
 * Hybrid search = vector search + keyword search, merged with Reciprocal Rank Fusion.
 * This is the "R" in RAG: Milestone 8's chat calls this to find context for the LLM.
 */
export async function search(
  deps: { db: Db; embedder: Embedder; log: FastifyBaseLogger },
  query: string,
  { topK, mode }: SearchOptions,
): Promise<SearchResponse> {
  const { db, embedder, log } = deps;
  const started = performance.now();
  const limit = candidateCount(topK);
  const warnings: string[] = [];

  // Start both searches at once: the keyword query doesn't need to wait for the
  // embedding API round-trip.
  const keywordPromise = mode === 'vector' ? Promise.resolve(null) : keywordSearch(db, query, limit);
  const vectorPromise =
    mode === 'keyword'
      ? Promise.resolve(null)
      : embedder.embed([query]).then(([v]) => vectorSearch(db, v!, embedder.model, limit));

  const [keywordSettled, vectorSettled] = await Promise.allSettled([keywordPromise, vectorPromise]);
  if (keywordSettled.status === 'rejected') throw keywordSettled.reason;

  let vectorHits: { id: string; similarity: number }[] | null = null;
  let modeUsed = mode;
  if (vectorSettled.status === 'fulfilled') {
    vectorHits = vectorSettled.value;
  } else {
    const err = vectorSettled.reason;
    // Graceful degradation: in hybrid mode, losing the embedding provider shouldn't take
    // search down. Keyword results are still useful. An explicit mode=vector request fails.
    const canFallBack =
      mode === 'hybrid' && err instanceof AppError && EMBEDDING_UNAVAILABLE.has(err.code);
    if (!canFallBack) throw err;
    modeUsed = 'keyword';
    warnings.push('Semantic search is unavailable, so these are keyword-only results.');
  }
  const keywordIds = keywordSettled.value;

  const fused = reciprocalRankFusion({
    ...(vectorHits && { vector: vectorHits.map((h) => h.id) }),
    ...(keywordIds && { keyword: keywordIds }),
  }).slice(0, topK);

  const chunks = await loadChunks(db, fused.map((f) => f.id));
  const similarity = new Map(vectorHits?.map((h) => [h.id, h.similarity]));

  const results = fused.flatMap((f): SearchResult[] => {
    const c = chunks.get(f.id);
    if (!c) return []; // deleted between the search and this lookup
    return [
      {
        chunkId: c.id,
        documentId: c.document_id,
        filename: c.filename,
        heading: c.heading,
        pageNumber: c.page_number,
        content: c.content,
        score: f.score,
        ranks: f.ranks,
        similarity: similarity.get(f.id) ?? null,
      },
    ];
  });

  // The query is user input and may contain personal data, so it is NOT logged.
  log.info(
    {
      search: {
        mode,
        modeUsed,
        vectorHits: vectorHits?.length ?? null,
        keywordHits: keywordIds?.length ?? null,
        results: results.length,
        durationMs: Math.round(performance.now() - started),
      },
    },
    'Search',
  );

  return { modeUsed, results, warnings };
}
