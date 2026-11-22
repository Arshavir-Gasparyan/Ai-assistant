import type { FastifyBaseLogger } from 'fastify';
import type { ChatModel } from '../llm/chat-model.js';
import { estimateTokens, fitToTokenBudget, HISTORY_TOKEN_BUDGET } from '../llm/budget.js';
import { CONDENSE_QUESTION, condenseSchema } from '../prompts/condense-question.js';
import { SUMMARIZE_CONVERSATION, summarySchema } from '../prompts/summarize-conversation.js';
import { z } from 'zod';
import type { ConversationState, ConversationStore, StoredMessage } from './store.js';

/**
 * Sliding window + summary:
 *
 *   stored messages:  [m1 m2 m3 m4 m5 m6 m7 m8 m9 m10 m11 m12]   12 > MAX_STORED_MESSAGES
 *                      └────── folded into summary ──┘ └ window ┘
 *   after compaction: summary="…m1–m6…"  [m7 m8 m9 m10 m11 m12]
 *
 * Compaction runs in batches (when 10 is exceeded, not on every message), so the
 * summarization LLM call happens every few turns rather than every turn.
 */
export const WINDOW_MESSAGES = 6; // 3 question/answer pairs kept verbatim
export const MAX_STORED_MESSAGES = 10;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}
export const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };

/** The recent messages that fit the history token budget (newest are kept first). */
export function recentHistory(messages: StoredMessage[]): StoredMessage[] {
  const window = messages.slice(-WINDOW_MESSAGES);
  const newestFirst = fitToTokenBudget([...window].reverse(), (m) => estimateTokens(m.content), HISTORY_TOKEN_BUDGET);
  return newestFirst.reverse();
}

/**
 * Turn a follow-up into a standalone question. First questions skip the LLM call entirely.
 * If the rewrite fails, fall back to the original question: a weaker search is better
 * than no answer.
 */
export async function condenseQuestion(
  chatModel: ChatModel,
  log: FastifyBaseLogger,
  state: Pick<ConversationState, 'summary' | 'messages'>,
  question: string,
  signal?: AbortSignal,
): Promise<{ standaloneQuestion: string; usage: Usage; rewritten: boolean }> {
  const history = recentHistory(state.messages);
  if (history.length === 0 && !state.summary) return { standaloneQuestion: question, usage: NO_USAGE, rewritten: false };

  try {
    const { json, usage } = await chatModel.completeJson(
      {
        messages: CONDENSE_QUESTION.build({ summary: state.summary, history, question }),
        schemaName: 'condense_question',
        jsonSchema: jsonSchemaOf(condenseSchema),
        maxOutputTokens: 200,
      },
      { signal },
    );
    const parsed = condenseSchema.safeParse(json);
    const standaloneQuestion = parsed.success ? parsed.data.standaloneQuestion.trim() : '';
    if (!standaloneQuestion || standaloneQuestion.length > 1000) {
      log.warn('Condense step returned an unusable question; using the original');
      return { standaloneQuestion: question, usage, rewritten: false };
    }
    return { standaloneQuestion, usage, rewritten: standaloneQuestion !== question };
  } catch (err) {
    if (signal?.aborted) throw err;
    log.warn({ code: (err as { code?: string }).code }, 'Condense step failed; using the original question');
    return { standaloneQuestion: question, usage: NO_USAGE, rewritten: false };
  }
}

/**
 * If the conversation has more than MAX_STORED_MESSAGES, fold the oldest ones into the
 * summary so that WINDOW_MESSAGES remain. Runs after the answer has been sent.
 */
export async function summarizeIfNeeded(
  deps: { store: ConversationStore; chatModel: ChatModel; log: FastifyBaseLogger },
  conversationId: string,
): Promise<void> {
  const { store, chatModel, log } = deps;
  const state = await store.load(conversationId);
  if (state.messages.length <= MAX_STORED_MESSAGES) return;

  const dropCount = state.messages.length - WINDOW_MESSAGES;
  const toFold = state.messages.slice(0, dropCount);
  const { json, usage } = await chatModel.completeJson({
    messages: SUMMARIZE_CONVERSATION.build(state.summary, toFold),
    schemaName: 'conversation_summary',
    jsonSchema: jsonSchemaOf(summarySchema),
    maxOutputTokens: 300,
  });
  const parsed = summarySchema.safeParse(json);
  if (!parsed.success || !parsed.data.summary.trim()) {
    log.warn('Summarization returned nothing usable; keeping messages as they are');
    return;
  }
  await store.compact(conversationId, parsed.data.summary.trim(), dropCount);
  // Summarization is spending too: count it against the conversation's budget.
  await store.append(conversationId, [], usage.inputTokens + usage.outputTokens);
  log.info({ memory: { folded: dropCount, kept: state.messages.length - dropCount } }, 'Conversation compacted');
}

function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema);
  return rest;
}
