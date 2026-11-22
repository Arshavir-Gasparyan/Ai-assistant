'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, searchChunks, type SearchMode, type SearchResponse } from '@/lib/api';
import { chunkLocation } from '@/lib/format';
import { Highlight } from './highlight';

const MODES: { value: SearchMode; label: string; hint: string }[] = [
  { value: 'hybrid', label: 'Hybrid', hint: 'Vector + keyword, merged with Reciprocal Rank Fusion' },
  { value: 'vector', label: 'Vector', hint: 'Meaning only (embeddings, cosine similarity)' },
  { value: 'keyword', label: 'Keyword', hint: 'Words only (Postgres full-text search, stemmed)' },
];
const TOP_K_OPTIONS = [3, 5, 10, 20];

const parseMode = (v: string | null): SearchMode =>
  v === 'vector' || v === 'keyword' ? v : 'hybrid';
const parseTopK = (v: string | null) => (TOP_K_OPTIONS.includes(Number(v)) ? Number(v) : 5);

type Result =
  | { key: string; status: 'ok'; data: SearchResponse }
  | { key: string; status: 'error'; message: string };

/**
 * The URL is the source of truth for the search (?q=…&mode=…&topK=…): results can be
 * shared or bookmarked, and the back button walks through previous searches.
 */
export function SearchPanel() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const q = params.get('q')?.trim() ?? '';
  const mode = parseMode(params.get('mode'));
  const topK = parseTopK(params.get('topK'));
  const requestKey = `${q}|${mode}|${topK}`;

  // The result remembers which request it belongs to. "Loading" is derived (the latest
  // result is for a different key), so there is no setState-before-fetch in the effect.
  const [result, setResult] = useState<Result | null>(null);
  const loading = q !== '' && result?.key !== requestKey;

  useEffect(() => {
    if (!q) return;
    const controller = new AbortController();
    searchChunks({ query: q, mode, topK }, controller.signal)
      .then((data) => setResult({ key: requestKey, status: 'ok', data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return; // a newer search replaced this one
        setResult({ key: requestKey, status: 'error', message: err instanceof ApiError ? err.message : 'Search failed' });
      });
    return () => controller.abort();
  }, [q, mode, topK, requestKey]);

  const navigate = (next: { q?: string; mode?: SearchMode; topK?: number }) => {
    const search = new URLSearchParams({
      q: next.q ?? q,
      mode: next.mode ?? mode,
      topK: String(next.topK ?? topK),
    });
    router.push(`${pathname}?${search}`);
  };

  const current = result?.key === requestKey ? result : null;

  return (
    <div>
      {/* key={q}: when the URL query changes (back button), the input resets to it. */}
      <SearchForm key={q} initialQuery={q} loading={loading} onSubmit={(query) => navigate({ q: query })} />

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <div className="inline-flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800" role="radiogroup" aria-label="Search mode">
          {MODES.map((m) => (
            <button
              key={m.value}
              role="radio"
              aria-checked={mode === m.value}
              title={m.hint}
              onClick={() => navigate({ mode: m.value })}
              className={`rounded px-3 py-1 font-medium transition-colors ${
                mode === m.value
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-zinc-500">
          Results
          <select
            value={topK}
            onChange={(e) => navigate({ topK: Number(e.target.value) })}
            className="rounded border border-zinc-200 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {TOP_K_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-zinc-500">{MODES.find((m) => m.value === mode)!.hint}</span>
      </div>

      <div className="mt-6">
        {!q && <p className="text-sm text-zinc-500">Try “How many vacation days can I carry over?” and compare the three modes.</p>}
        {loading && <p className="text-sm text-zinc-500">Searching…</p>}
        {current?.status === 'error' && <p className="text-sm text-red-600 dark:text-red-400">{current.message}</p>}
        {current?.status === 'ok' && <Results data={current.data} />}
      </div>
    </div>
  );
}

function SearchForm({ initialQuery, loading, onSubmit }: { initialQuery: string; loading: boolean; onSubmit: (q: string) => void }) {
  const [draft, setDraft] = useState(initialQuery);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) onSubmit(draft.trim());
      }}
      className="flex gap-2"
      role="search"
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={500}
        placeholder="Ask or search your documents…"
        aria-label="Search query"
        className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
      />
      <button
        type="submit"
        disabled={loading || !draft.trim()}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Search
      </button>
    </form>
  );
}

function Results({ data }: { data: SearchResponse }) {
  return (
    <>
      {data.warnings.map((w) => (
        <p key={w} className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {w}
        </p>
      ))}
      <p className="mb-3 text-xs text-zinc-500">
        {data.results.length} results · mode used: <strong>{data.modeUsed}</strong>
      </p>
      {data.results.length === 0 ? (
        <p className="text-sm text-zinc-500">No matching chunks.</p>
      ) : (
        <ol className="space-y-3">
          {data.results.map((r, i) => (
            <li key={r.chunkId} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm">
                  <span className="mr-2 font-semibold tabular-nums text-zinc-400">#{i + 1}</span>
                  <span className="font-medium">{r.filename}</span>
                  <span className="text-zinc-500"> › {chunkLocation(r)}</span>
                </p>
                <RankBadges result={r} />
              </div>
              <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                <Highlight text={r.content} query={data.query} />
              </p>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** Why did this chunk rank here? Shows each search's opinion and the fused score. */
function RankBadges({ result }: { result: SearchResponse['results'][number] }) {
  const badge = 'rounded px-1.5 py-0.5 text-xs tabular-nums';
  const missing = 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500';
  return (
    <div className="flex flex-wrap gap-1">
      <span
        className={`${badge} ${result.ranks.vector ? 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' : missing}`}
        title="Position in vector (meaning) search"
      >
        vector {result.ranks.vector ? `#${result.ranks.vector}` : '—'}
        {result.similarity !== null && ` · sim ${result.similarity.toFixed(2)}`}
      </span>
      <span
        className={`${badge} ${result.ranks.keyword ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' : missing}`}
        title="Position in keyword (full-text) search"
      >
        keyword {result.ranks.keyword ? `#${result.ranks.keyword}` : '—'}
      </span>
      <span className={`${badge} bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`} title="RRF score = Σ 1/(60 + rank)">
        RRF {result.score.toFixed(4)}
      </span>
    </div>
  );
}
