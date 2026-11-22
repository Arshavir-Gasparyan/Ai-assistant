import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { embeddingInput, type Embedder } from '../embeddings/embedder.js';
import * as repo from '../documents/repository.js';
import type { DocumentDto } from '../documents/repository.js';
import { AppError } from '../errors.js';
import { chunkSections, DEFAULT_CHUNK_OPTIONS, type ChunkOptions } from './chunker.js';
import { detectFileKind, extractDocument } from './extract.js';

export type IngestOutcome = 'created' | 'replaced' | 'unchanged';

export interface IngestResult {
  outcome: IngestOutcome;
  document: DocumentDto;
}

/**
 * Keep only a safe display name: no directories ("../../etc/passwd" → "passwd"),
 * no control characters, bounded length. We never use it as a file path (nothing
 * is written to disk), but it's shown in the UI and used as the document's identity.
 */
export function sanitizeFilename(raw: string): string {
  const name = basename(raw.replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 255);
  if (!name || name === '.' || name === '..') {
    throw new AppError(400, 'INVALID_FILENAME', 'The file must have a valid name');
  }
  return name;
}

/**
 * The ingestion pipeline:
 *
 *   validate type → hash → unchanged? stop
 *                        → extract text → chunk → EMBED → [transaction: upsert document,
 *                                                          delete old chunks, insert new chunks]
 *
 * IDEMPOTENT: uploading the same file twice gives the same end state as uploading it once.
 *  - same filename + same bytes + same embedding model → 'unchanged', nothing is rewritten
 *    (a different model means the stored vectors are incompatible, so we re-embed)
 *  - same filename + new bytes  → 'replaced': old chunks deleted, new ones inserted
 *  - new filename               → 'created'
 * The transaction means readers never see a half-replaced document (old chunks gone,
 * new ones not yet written). If anything fails, the previous version stays intact.
 */
export async function ingestDocument(
  db: Db,
  embedder: Embedder,
  log: FastifyBaseLogger,
  input: { filename: string; data: Buffer },
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): Promise<IngestResult> {
  const startedAt = performance.now();
  const filename = sanitizeFilename(input.filename);

  const kind = detectFileKind(filename, input.data);
  if (!kind) {
    throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only PDF (.pdf) and Markdown (.md) files are supported');
  }

  const contentHash = createHash('sha256').update(input.data).digest('hex');
  const existing = await repo.findDocumentByFilename(db, filename);
  if (
    existing &&
    existing.contentHash === contentHash &&
    existing.embeddingModel === embedder.model &&
    existing.status === 'ready'
  ) {
    return { outcome: 'unchanged', document: existing };
  }

  const { sections, pageCount } = await extractDocument(kind, input.data);
  const chunks = chunkSections(sections, options);
  if (chunks.length === 0) {
    throw new AppError(422, 'EMPTY_DOCUMENT', 'The document contains no text');
  }

  // Embed BEFORE opening the transaction. API calls are slow (hundreds of ms per batch),
  // and holding a transaction open that long would lock rows and tie up a pooled connection.
  const embeddings = await embedder.embed(chunks.map(embeddingInput));

  const document = await withTransaction(db, async (tx) => {
    const doc = await repo.upsertDocument(tx, {
      filename,
      kind,
      sizeBytes: input.data.length,
      contentHash,
      pageCount,
      chunkCount: chunks.length,
      embeddingModel: embedder.model,
    });
    await repo.deleteChunks(tx, doc.id);
    await repo.insertChunks(tx, doc.id, chunks, embeddings);
    return doc;
  });

  const outcome: IngestOutcome = existing ? 'replaced' : 'created';
  // Log metadata only: no filename (can contain personal info) and no document text.
  log.info(
    {
      documentId: document.id,
      outcome,
      kind,
      sizeBytes: input.data.length,
      chunks: chunks.length,
      durationMs: Math.round(performance.now() - startedAt),
    },
    'Document ingested',
  );
  return { outcome, document };
}
