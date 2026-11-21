import type pg from 'pg';
import type { Chunk } from '../ingestion/chunker.js';
import type { FileKind } from '../ingestion/extract.js';

/**
 * All SQL for documents and chunks lives here. Routes and services call these functions
 * and never write SQL themselves.
 *
 * Rows come back snake_case from Postgres. We map them to camelCase DTOs (Data Transfer
 * Objects) so the API shape doesn't change if a column is renamed.
 */

type Queryable = pg.Pool | pg.PoolClient;

export interface DocumentDto {
  id: string;
  filename: string;
  kind: FileKind;
  sizeBytes: number;
  contentHash: string;
  pageCount: number | null;
  chunkCount: number;
  status: 'processing' | 'ready' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface ChunkDto {
  id: string;
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  heading: string | null;
  tokenEstimate: number;
}

interface DocumentRow {
  id: string;
  filename: string;
  kind: FileKind;
  size_bytes: number;
  content_hash: string;
  page_count: number | null;
  chunk_count: number;
  status: DocumentDto['status'];
  created_at: Date;
  updated_at: Date;
}

const toDocumentDto = (r: DocumentRow): DocumentDto => ({
  id: r.id,
  filename: r.filename,
  kind: r.kind,
  sizeBytes: r.size_bytes,
  contentHash: r.content_hash,
  pageCount: r.page_count,
  chunkCount: r.chunk_count,
  status: r.status,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

export async function findDocumentByFilename(db: Queryable, filename: string) {
  const { rows } = await db.query<DocumentRow>('SELECT * FROM documents WHERE filename = $1', [filename]);
  return rows[0] ? toDocumentDto(rows[0]) : null;
}

export async function listDocuments(db: Queryable): Promise<DocumentDto[]> {
  const { rows } = await db.query<DocumentRow>('SELECT * FROM documents ORDER BY updated_at DESC');
  return rows.map(toDocumentDto);
}

export async function getDocument(db: Queryable, id: string) {
  const { rows } = await db.query<DocumentRow>('SELECT * FROM documents WHERE id = $1', [id]);
  return rows[0] ? toDocumentDto(rows[0]) : null;
}

export async function getChunks(db: Queryable, documentId: string): Promise<ChunkDto[]> {
  const { rows } = await db.query<{
    id: string;
    chunk_index: number;
    content: string;
    page_number: number | null;
    heading: string | null;
    token_estimate: number;
  }>(
    `SELECT id, chunk_index, content, page_number, heading, token_estimate
       FROM chunks WHERE document_id = $1 ORDER BY chunk_index`,
    [documentId],
  );
  return rows.map((r) => ({
    id: r.id,
    chunkIndex: r.chunk_index,
    content: r.content,
    pageNumber: r.page_number,
    heading: r.heading,
    tokenEstimate: r.token_estimate,
  }));
}

/** Returns true if a document was deleted. Its chunks go too (ON DELETE CASCADE). */
export async function deleteDocument(db: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM documents WHERE id = $1', [id]);
  return rowCount === 1;
}

export interface UpsertDocumentInput {
  filename: string;
  kind: FileKind;
  sizeBytes: number;
  contentHash: string;
  pageCount: number | null;
  chunkCount: number;
}

/**
 * INSERT, or UPDATE if a document with this filename exists ("upsert").
 * ON CONFLICT relies on the UNIQUE constraint on filename. The existing row keeps its id,
 * so links to /documents/:id stay valid across re-uploads.
 */
export async function upsertDocument(db: Queryable, d: UpsertDocumentInput): Promise<DocumentDto> {
  const { rows } = await db.query<DocumentRow>(
    `INSERT INTO documents (filename, kind, size_bytes, content_hash, page_count, chunk_count, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'ready')
     ON CONFLICT (filename) DO UPDATE SET
       kind = EXCLUDED.kind,
       size_bytes = EXCLUDED.size_bytes,
       content_hash = EXCLUDED.content_hash,
       page_count = EXCLUDED.page_count,
       chunk_count = EXCLUDED.chunk_count,
       status = 'ready',
       updated_at = now()
     RETURNING *`,
    [d.filename, d.kind, d.sizeBytes, d.contentHash, d.pageCount, d.chunkCount],
  );
  return toDocumentDto(rows[0]!);
}

export async function deleteChunks(db: Queryable, documentId: string): Promise<void> {
  await db.query('DELETE FROM chunks WHERE document_id = $1', [documentId]);
}

/**
 * Insert all chunks in ONE query. Instead of 200 INSERTs (200 round trips), we send one
 * array per column and let Postgres `unnest` them back into rows. It also sidesteps the
 * 65,535-parameter limit you'd hit with a giant multi-row VALUES list.
 */
export async function insertChunks(db: Queryable, documentId: string, chunks: Chunk[]): Promise<void> {
  if (chunks.length === 0) return;
  await db.query(
    `INSERT INTO chunks (document_id, chunk_index, content, page_number, heading, token_estimate)
     SELECT $1, * FROM unnest($2::int[], $3::text[], $4::int[], $5::text[], $6::int[])`,
    [
      documentId,
      chunks.map((c) => c.chunkIndex),
      chunks.map((c) => c.content),
      chunks.map((c) => c.pageNumber),
      chunks.map((c) => c.heading),
      chunks.map((c) => c.tokenEstimate),
    ],
  );
}
