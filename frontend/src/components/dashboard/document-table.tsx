'use client';

import { useState } from 'react';
import { ApiError, deleteDocument, type DocumentSummary } from '@/lib/api';
import { formatBytes, formatDate } from '@/lib/format';

interface Props {
  documents: DocumentSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeleted: (id: string) => void;
}

export function DocumentTable({ documents, selectedId, onSelect, onDeleted }: Props) {
  // Two-step delete: the first click asks, the second confirms. Avoids an accidental
  // click wiping a document (and its chunks and embeddings) without a modal dialog.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      await deleteDocument(id);
      onDeleted(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  }

  if (documents.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 p-6 text-sm text-zinc-500 dark:border-zinc-800">
        No documents yet. Upload one above. Try the samples in <code>documents/</code>.
      </p>
    );
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-3 py-2 font-medium">Document</th>
              <th className="px-3 py-2 font-medium">Chunks</th>
              <th className="px-3 py-2 font-medium">Size</th>
              <th className="px-3 py-2 font-medium">Embedding model</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr
                key={d.id}
                className={`border-b border-zinc-100 last:border-0 dark:border-zinc-800 ${
                  d.id === selectedId ? 'bg-zinc-100 dark:bg-zinc-800' : ''
                }`}
              >
                <td className="px-3 py-2">
                  <button onClick={() => onSelect(d.id)} className="text-left font-medium hover:underline">
                    {d.filename}
                  </button>
                  <div className="text-xs text-zinc-500">
                    {d.kind === 'pdf' ? `PDF · ${d.pageCount} pages` : 'Markdown'} · updated {formatDate(d.updatedAt)}
                  </div>
                </td>
                <td className="px-3 py-2 tabular-nums">{d.chunkCount}</td>
                <td className="px-3 py-2 tabular-nums">{formatBytes(d.sizeBytes)}</td>
                <td className="px-3 py-2">
                  <code className="text-xs">{d.embeddingModel ?? '—'}</code>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button
                    onClick={() => onSelect(d.id)}
                    className="rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Chunks
                  </button>
                  {confirmingId === d.id ? (
                    <>
                      <button
                        onClick={() => void remove(d.id)}
                        disabled={deletingId === d.id}
                        className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                      >
                        {deletingId === d.id ? 'Deleting…' : 'Confirm delete'}
                      </button>
                      <button
                        onClick={() => setConfirmingId(null)}
                        className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmingId(d.id)}
                      className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
