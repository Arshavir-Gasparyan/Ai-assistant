import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../db/pool.js';
import { AppError } from '../errors.js';
import { ingestDocument } from '../ingestion/ingest.js';
import * as repo from './repository.js';

const documentSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  kind: z.enum(['pdf', 'markdown']),
  sizeBytes: z.number(),
  contentHash: z.string(),
  pageCount: z.number().nullable(),
  chunkCount: z.number(),
  status: z.enum(['processing', 'ready', 'failed']),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const chunkSchema = z.object({
  id: z.uuid(),
  chunkIndex: z.number(),
  content: z.string(),
  pageNumber: z.number().nullable(),
  heading: z.string().nullable(),
  tokenEstimate: z.number(),
});

const idParams = z.object({ id: z.uuid() });

const notFound = () => new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');

export const documentRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  /**
   * POST /documents (multipart/form-data, field "file")
   *   201 created | 200 replaced or unchanged | 413 too large | 415 wrong type | 422 no text
   */
  app.post(
    '/documents',
    {
      schema: {
        response: {
          200: z.object({ outcome: z.enum(['replaced', 'unchanged']), document: documentSchema }),
          201: z.object({ outcome: z.literal('created'), document: documentSchema }),
        },
      },
    },
    async (request, reply) => {
      if (!request.isMultipart()) {
        throw new AppError(415, 'MULTIPART_REQUIRED', 'Upload the file as multipart/form-data in a "file" field');
      }
      const file = await request.file();
      if (!file || file.fieldname !== 'file') {
        throw new AppError(400, 'FILE_REQUIRED', 'Upload the file in a "file" field');
      }

      // Reads the stream into memory. Throws a 413 error if it exceeds the configured limit.
      const data = await file.toBuffer();
      if (data.length === 0) throw new AppError(400, 'EMPTY_FILE', 'The uploaded file is empty');

      const result = await ingestDocument(db, request.log, { filename: file.filename, data });
      if (result.outcome === 'created') {
        return reply.status(201).send({ outcome: 'created', document: result.document });
      }
      return reply.status(200).send({ outcome: result.outcome, document: result.document });
    },
  );

  app.get(
    '/documents',
    { schema: { response: { 200: z.object({ documents: z.array(documentSchema) }) } } },
    async () => ({ documents: await repo.listDocuments(db) }),
  );

  app.get(
    '/documents/:id',
    {
      schema: {
        params: idParams,
        response: { 200: documentSchema.extend({ chunks: z.array(chunkSchema) }) },
      },
    },
    async (request) => {
      const document = await repo.getDocument(db, request.params.id);
      if (!document) throw notFound();
      return { ...document, chunks: await repo.getChunks(db, document.id) };
    },
  );

  app.delete('/documents/:id', { schema: { params: idParams } }, async (request, reply) => {
    const deleted = await repo.deleteDocument(db, request.params.id);
    if (!deleted) throw notFound();
    return reply.status(204).send();
  });
};
