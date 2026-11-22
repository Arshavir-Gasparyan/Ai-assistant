'use client';

import { useRef, useState } from 'react';
import { ApiError, uploadDocument, type UploadOutcome } from '@/lib/api';

// Mirrors the backend defaults (MAX_UPLOAD_BYTES, accepted types). These checks are only
// for fast feedback: the backend validates again (by content, not just extension).
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ['.pdf', '.md', '.markdown'];

type ItemState =
  | { status: 'queued' | 'uploading' }
  | { status: 'done'; outcome: UploadOutcome; chunks: number }
  | { status: 'error'; message: string };

interface Item {
  key: string;
  name: string;
  state: ItemState;
}

function clientSideError(file: File): string | null {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!ACCEPTED.includes(ext)) return 'Only PDF and Markdown files are supported';
  if (file.size === 0) return 'File is empty';
  if (file.size > MAX_BYTES) return 'File is larger than 10 MB';
  return null;
}

const outcomeText: Record<UploadOutcome, string> = {
  created: 'Added',
  replaced: 'Updated (re-chunked and re-embedded)',
  unchanged: 'Unchanged (same content already indexed)',
};

export function UploadDropzone({ onUploaded }: { onUploaded: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (key: string, state: ItemState) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, state } : it)));

  async function handleFiles(fileList: FileList | null) {
    if (!fileList?.length || busy) return;
    const files = [...fileList];
    const batch = files.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name, file: f }));
    setItems(batch.map(({ key, name }) => ({ key, name, state: { status: 'queued' } })));
    setBusy(true);

    // One file per request, one at a time: the backend accepts a single file per upload,
    // and embedding calls are rate-limited, so parallel uploads would not be faster.
    for (const { key, file } of batch) {
      const invalid = clientSideError(file);
      if (invalid) {
        update(key, { status: 'error', message: invalid });
        continue;
      }
      update(key, { status: 'uploading' });
      try {
        const { outcome, document } = await uploadDocument(file);
        update(key, { status: 'done', outcome, chunks: document.chunkCount });
        onUploaded();
      } catch (err) {
        update(key, { status: 'error', message: err instanceof ApiError ? err.message : 'Upload failed' });
      }
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = ''; // allow re-selecting the same file
  }

  return (
    <section className="mb-8">
      <label
        onDragOver={(e) => {
          e.preventDefault(); // required, otherwise the browser opens the dropped file
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging
            ? 'border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-800'
            : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500'
        } ${busy ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED.join(',')}
          className="sr-only"
          onChange={(e) => void handleFiles(e.target.files)}
          disabled={busy}
        />
        <span className="text-sm font-medium">{busy ? 'Uploading…' : 'Drop PDF or Markdown files here, or click to choose'}</span>
        <span className="mt-1 text-xs text-zinc-500">Up to 10 MB each. Re-uploading a file with the same name updates it.</span>
      </label>

      {items.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm" aria-live="polite">
          {items.map(({ key, name, state }) => (
            <li key={key} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{name}</span>
              {state.status === 'queued' && <span className="text-zinc-500">waiting…</span>}
              {state.status === 'uploading' && <span className="text-zinc-500">extracting, chunking, embedding…</span>}
              {state.status === 'done' && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  {outcomeText[state.outcome]} · {state.chunks} chunks
                </span>
              )}
              {state.status === 'error' && <span className="text-red-600 dark:text-red-400">{state.message}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
