import type { FastifyBaseLogger } from 'fastify';

/**
 * USD per 1 million tokens. Check provider pricing pages when adding a model:
 * https://developers.openai.com/api/docs/pricing
 * Chat prices checked 2026-11-22. Sources disagreed for gpt-4.1-mini, so verify before
 * relying on cost reports. Output tokens cost several times more than input tokens.
 */
const PRICING_PER_MILLION: Record<string, { input: number; output: number }> = {
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-5-mini': { input: 0.25, output: 2.0 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens = 0): number | null {
  const price = PRICING_PER_MILLION[model];
  if (!price) return null; // unknown model (or local/free): don't invent a number
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export interface LlmCall {
  provider: 'openai' | 'anthropic' | 'ollama' | 'fake';
  model: string;
  operation: 'embedding' | 'chat';
  inputTokens: number;
  outputTokens?: number;
  latencyMs: number;
  /** How many items were sent in this call (e.g. texts in an embedding batch). */
  items?: number;
  /** Streaming calls: time until the first piece of text arrived (what users perceive). */
  streamed?: boolean;
  timeToFirstTokenMs?: number;
}

/**
 * Every call to a model goes through here: one consistent, machine-readable log line
 * with provider, model, tokens, latency and cost. Evaluation and cost reports
 * (Milestone 15) are built on these.
 *
 * Deliberately NOT logged: prompts, document text, API keys.
 */
export function logLlmCall(log: FastifyBaseLogger, call: LlmCall): void {
  const outputTokens = call.outputTokens ?? 0;
  log.info(
    {
      llm: {
        ...call,
        outputTokens,
        latencyMs: Math.round(call.latencyMs),
        ...(call.timeToFirstTokenMs !== undefined && { timeToFirstTokenMs: Math.round(call.timeToFirstTokenMs) }),
        costUsd: estimateCostUsd(call.model, call.inputTokens, outputTokens),
      },
    },
    'LLM call',
  );
}
