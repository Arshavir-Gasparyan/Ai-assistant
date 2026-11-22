/**
 * Reciprocal Rank Fusion (RRF): merge several ranked lists into one.
 *
 * Why not just add the scores? Vector search returns cosine similarity (0..1) and keyword
 * search returns ts_rank (any positive number). They are on different scales, so a sum
 * would let one list dominate. RRF ignores scores and uses only POSITIONS:
 *
 *   score(chunk) = Σ over lists  1 / (k + rank)        rank starts at 1
 *
 * With k = 60 (the value from the original RRF paper, Cormack et al. 2009):
 *   #1 in both lists          → 1/61 + 1/61 = 0.0328
 *   #1 in one list only       → 1/61        = 0.0164
 *   #3 in one, #5 in other    → 1/63 + 1/65 = 0.0313   ← agreement beats a single #1
 *
 * k dampens the top: a bigger k makes rank 1 vs rank 5 matter less.
 */
export const RRF_K = 60;

export type ListName = 'vector' | 'keyword';

export interface FusedResult {
  id: string;
  score: number;
  /** 1-based position in each list, or null if the list did not return this id. */
  ranks: Record<ListName, number | null>;
}

export function reciprocalRankFusion(
  lists: Partial<Record<ListName, readonly string[]>>,
  k = RRF_K,
): FusedResult[] {
  const fused = new Map<string, FusedResult>();

  for (const [name, ids] of Object.entries(lists) as [ListName, readonly string[]][]) {
    ids.forEach((id, index) => {
      const rank = index + 1;
      const entry = fused.get(id) ?? { id, score: 0, ranks: { vector: null, keyword: null } };
      entry.score += 1 / (k + rank);
      entry.ranks[name] = rank;
      fused.set(id, entry);
    });
  }

  // Highest score first. Ties are broken by the best single rank, then by id, so the
  // output order is deterministic (important for tests and for reproducible evaluation).
  const bestRank = (r: FusedResult) => Math.min(r.ranks.vector ?? Infinity, r.ranks.keyword ?? Infinity);
  return [...fused.values()].sort(
    (a, b) => b.score - a.score || bestRank(a) - bestRank(b) || a.id.localeCompare(b.id),
  );
}
