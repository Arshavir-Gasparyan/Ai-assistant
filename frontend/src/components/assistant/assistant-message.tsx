'use client';

import { useState } from 'react';
import type { ChatAnswer, ChatMeta, Citation, RefusalReason } from '@/lib/api';
import { chunkLocation } from '@/lib/format';

export type AssistantStatus = 'retrieving' | 'streaming' | 'done' | 'error' | 'stopped';

export interface AssistantMessageData {
  id: string;
  status: AssistantStatus;
  /** Streamed preview text; replaced by answer.answer when the stream is done. */
  text: string;
  meta?: ChatMeta;
  answer?: ChatAnswer;
  error?: string;
}

const refusalText: Record<RefusalReason, string> = {
  no_sources: 'No matching passages were found in your documents.',
  not_in_sources: 'Passages were found, but they do not contain the answer.',
  no_valid_citations: 'The model answered without citing a source, so the answer was withheld.',
};

/**
 * Turns "Five days [1][2]." into text + clickable citation markers. While streaming,
 * markers are plain (citations aren't verified yet); after `done` they link to sources.
 */
function AnswerText({
  text,
  citations,
  active,
  onCite,
}: {
  text: string;
  citations: Citation[] | null;
  active: number | null;
  onCite: (n: number) => void;
}) {
  const parts = text.split(/(\[\d+\])/);
  return (
    <>
      {parts.map((part, i) => {
        const n = /^\[(\d+)\]$/.exec(part)?.[1];
        if (!n) return <span key={i}>{part}</span>;
        const valid = citations?.some((c) => c.n === Number(n));
        if (!valid) return <span key={i} className="text-zinc-400">{part}</span>;
        return (
          <button
            key={i}
            onClick={() => onCite(Number(n))}
            className={`mx-0.5 rounded px-1 align-super text-[0.7em] font-semibold transition-colors ${
              active === Number(n)
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200'
            }`}
            aria-label={`Show source ${n}`}
          >
            {n}
          </button>
        );
      })}
    </>
  );
}

export function AssistantMessage({ message }: { message: AssistantMessageData }) {
  const [active, setActive] = useState<number | null>(null);
  const { status, answer, meta } = message;

  const cite = (n: number) => {
    setActive(n);
    document.getElementById(`cite-${message.id}-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const refused = answer && !answer.answerable;
  const text = answer ? answer.answer : message.text;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {meta?.warnings.map((w) => (
        <p key={w} className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {w}
        </p>
      ))}

      {status === 'retrieving' && <p className="text-sm text-zinc-500">Searching your documents…</p>}

      {status !== 'retrieving' && (
        <div className={`whitespace-pre-wrap text-sm leading-relaxed ${refused ? 'text-amber-800 dark:text-amber-300' : ''}`}>
          {status === 'streaming' && !text && <span className="text-zinc-500">Writing answer…</span>}
          <AnswerText text={text} citations={answer?.citations ?? null} active={active} onCite={cite} />
          {status === 'streaming' && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-zinc-400 align-text-bottom" aria-hidden />}
        </div>
      )}

      {refused && answer.refusalReason && <p className="mt-1 text-xs text-zinc-500">{refusalText[answer.refusalReason]}</p>}
      {status === 'error' && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{message.error}</p>}
      {status === 'stopped' && <p className="mt-2 text-xs text-zinc-500">Stopped.</p>}

      {answer && answer.citations.length > 0 && (
        <ol className="mt-4 space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          {answer.citations.map((c) => (
            <li
              key={c.n}
              id={`cite-${message.id}-${c.n}`}
              className={`rounded border p-2 text-xs transition-colors ${
                active === c.n ? 'border-zinc-900 dark:border-zinc-100' : 'border-zinc-200 dark:border-zinc-800'
              }`}
            >
              <button onClick={() => setActive(active === c.n ? null : c.n)} className="w-full text-left">
                <span className="mr-1 font-semibold">[{c.n}]</span>
                <span className="font-medium">{c.filename}</span>
                <span className="text-zinc-500"> › {chunkLocation(c)}</span>
              </button>
              {active === c.n && <p className="mt-1 whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{c.snippet}</p>}
            </li>
          ))}
        </ol>
      )}

      {meta && (
        <p className="mt-3 text-[11px] text-zinc-400">
          {meta.model} · {meta.promptVersion} · {meta.retrieval.modeUsed} search · {meta.retrieval.sources} passages
        </p>
      )}
    </div>
  );
}
