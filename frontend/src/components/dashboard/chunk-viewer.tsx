'use client';

import { useEffect, useState } from 'react';
import { ApiError, getDocument, type Chunk, type DocumentSummary } from '@/lib/api';
import { chunkLocation } from '@/lib/format';

type Loaded =
  | { id: string; status: 'error'; message: string }
  | { id: string; status: 'ready'; document: DocumentSummary & { chunks: Chunk[] } };

/**
 * Shows how a document was split. This is where chunking stops being abstract: you can
 * see each chunk's heading path, its overlap with the next one, and its size in tokens.
 */
export function ChunkViewer({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  // The loaded data remembers which document it is for; if that's not the selected one,
  // we're loading. Derived state instead of a setState({loading}) inside the effect.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const state = loaded?.id === documentId ? loaded : { status: 'loading' as const };

  useEffect(() => {
    const controller = new AbortController();
    getDocument(documentId, controller.signal)
      .then((document) => setLoaded({ id: documentId, status: 'ready', document }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return; // switched to another document
        setLoaded({ id: documentId, status: 'error', message: err instanceof ApiError ? err.message : 'Could not load chunks' });
      });
    return () => controller.abort();
  }, [documentId]);

  return (
    <aside className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <h2 className="truncate text-sm font-semibold">
          {state.status === 'ready' ? `${state.document.filename} · ${state.document.chunks.length} chunks` : 'Chunks'}
        </h2>
        <button onClick={onClose} className="text-xs text-zinc-500 hover:underline">
          Close
        </button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto p-4">
        {state.status === 'loading' && <p className="text-sm text-zinc-500">Loading…</p>}
        {state.status === 'error' && <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>}
        {state.status === 'ready' && (
          <ol className="space-y-4">
            {state.document.chunks.map((c) => (
              <li key={c.id} className="text-sm">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-xs text-zinc-500">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    #{c.chunkIndex} · {chunkLocation(c)}
                  </span>
                  <span className="tabular-nums">~{c.tokenEstimate} tokens</span>
                </div>
                <p className="whitespace-pre-wrap rounded bg-zinc-50 p-2 text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                  {c.content}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
