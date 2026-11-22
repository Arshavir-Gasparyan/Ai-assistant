'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, listDocuments, type DocumentSummary } from '@/lib/api';
import { ChunkViewer } from './chunk-viewer';
import { DocumentTable } from './document-table';
import { UploadDropzone } from './upload-dropzone';

/**
 * Owns the dashboard state (document list + selected document) so the upload area,
 * the table and the chunk viewer stay in sync. Data comes from the browser calling the
 * backend directly (ADR-0002), so this is a Client Component.
 */
export function DocumentsDashboard() {
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) =>
      listDocuments(signal).then(
        (docs) => {
          setDocuments(docs);
          setError(null);
        },
        (err: unknown) => {
          if (signal?.aborted) return;
          setError(err instanceof ApiError ? err.message : 'Could not load documents');
        },
      ),
    [],
  );

  // Initial load. setState only runs in the promise callbacks (after the response),
  // never synchronously inside the effect.
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // After an upload or delete.
  const refresh = () => void load();

  const totalChunks = documents?.reduce((sum, d) => sum + d.chunkCount, 0) ?? 0;

  return (
    <>
      <UploadDropzone onUploaded={refresh} />

      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Documents</h2>
        {documents && (
          <span className="text-xs text-zinc-500">
            {documents.length} documents · {totalChunks} chunks
          </span>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {documents === null && !error && <p className="text-sm text-zinc-500">Loading…</p>}

      {documents && (
        <div className={`grid gap-6 ${selectedId ? 'lg:grid-cols-5' : ''}`}>
          <div className={selectedId ? 'lg:col-span-3' : ''}>
            <DocumentTable
              documents={documents}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onDeleted={(id) => {
                if (id === selectedId) setSelectedId(null);
                refresh();
              }}
            />
          </div>
          {selectedId && (
            <div className="lg:col-span-2">
              <ChunkViewer documentId={selectedId} onClose={() => setSelectedId(null)} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
