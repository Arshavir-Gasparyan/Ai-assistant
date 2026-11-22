import { Fragment } from 'react';

const STOPWORDS = new Set(['the', 'and', 'for', 'are', 'can', 'how', 'many', 'much', 'what', 'when', 'who', 'why', 'does', 'with', 'from', 'that', 'this', 'there', 'you', 'your']);

/**
 * Marks words from the query in a result. It approximates what Postgres matched: a crude
 * stem ("carry" → "carr" also marks "carried"). Postgres's real stemmer is smarter, and
 * vector matches may share no words at all, which is the point of semantic search.
 */
export function Highlight({ text, query }: { text: string; query: string }) {
  const stems = (query.toLowerCase().match(/\p{L}{3,}/gu) ?? [])
    .filter((w) => !STOPWORDS.has(w))
    .map((w) => w.replace(/(ing|ed|es|s|y)$/, ''))
    .filter((w) => w.length >= 3)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (stems.length === 0) return <>{text}</>;

  // A capturing group in split() keeps the matches: odd indexes are the highlighted words.
  const parts = text.split(new RegExp(`(\\b(?:${stems.join('|')})\\p{L}*)`, 'giu'));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-amber-200 px-0.5 text-inherit dark:bg-amber-700/60">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
