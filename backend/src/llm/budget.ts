import { estimateTokens } from '../ingestion/chunker.js';

export { estimateTokens };

/**
 * Token budgets for the PROMPT. Every token sent costs money and adds latency, and models
 * have a hard context limit. So each part of the prompt gets an explicit allowance:
 *
 *   system prompt (fixed) + sources ≤ SOURCE_TOKEN_BUDGET + question ≤ 1000 chars
 *   output ≤ max_completion_tokens (600)
 *
 * Tokens are ESTIMATED as characters / 4 (good enough for English budgeting; a tokenizer
 * like tiktoken would be exact but adds a dependency and CPU per request).
 */
export const SOURCE_TOKEN_BUDGET = 3_000;
export const HISTORY_TOKEN_BUDGET = 1_500;

/**
 * Keep items, in order, while their total cost fits the budget. The first item is always
 * kept (it's the most relevant source / most recent message): an empty context is worse
 * than one slightly over budget.
 */
export function fitToTokenBudget<T>(items: readonly T[], cost: (item: T) => number, budget: number): T[] {
  const kept: T[] = [];
  let used = 0;
  for (const item of items) {
    const c = cost(item);
    if (kept.length > 0 && used + c > budget) break;
    kept.push(item);
    used += c;
  }
  return kept;
}
