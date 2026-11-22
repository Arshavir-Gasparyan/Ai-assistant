import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../errors.js';
import type { ChatModel } from '../llm/chat-model.js';
import { condenseQuestion, summarizeIfNeeded, type Usage } from '../memory/memory.js';
import type { ConversationState, ConversationStore } from '../memory/store.js';
import type { SearchResponse } from '../search/search.js';
import { answerQuestion, type ChatAnswer, type ChatStreamEvent } from './answer.js';

const MEMORY_UNAVAILABLE = 'Conversation memory is unavailable, so this question was answered on its own.';

export interface ChatTurnAnswer extends ChatAnswer {
  conversationId: string;
  /** What was actually searched: the follow-up rewritten using the conversation. */
  standaloneQuestion: string;
}

/** The meta event gains the conversation fields, so the UI can show them immediately. */
export type ChatTurnEvent =
  | (Extract<ChatStreamEvent, { type: 'meta' }> & { conversationId: string; standaloneQuestion: string })
  | Extract<ChatStreamEvent, { type: 'delta' }>;

export interface ChatServiceDeps {
  retrieve: (question: string, topK: number) => Promise<SearchResponse>;
  chatModel: ChatModel;
  store: ConversationStore;
  log: FastifyBaseLogger;
  /** Max LLM tokens (in + out) one conversation may use. */
  conversationTokenBudget: number;
  /** Where post-answer work (summarization) runs. Tests pass a collector to await it. */
  background?: (task: Promise<unknown>) => void;
}

/**
 * One chat turn:
 *   1. load the conversation (Redis) and check its token budget
 *   2. rewrite a follow-up into a standalone question (skipped for the first question)
 *   3. RAG: retrieve → prompt → answer → verify (answer.ts, unchanged by memory)
 *   4. store the question + answer and the tokens spent
 *   5. in the background: fold old messages into the summary if the window is full
 *
 * If Redis is down, steps 1, 4 and 5 are skipped with a warning: the user still gets an answer.
 */
export async function chatTurn(
  deps: ChatServiceDeps,
  input: { question: string; topK: number; conversationId?: string },
  stream?: { onEvent: (event: ChatTurnEvent) => void; signal?: AbortSignal },
): Promise<ChatTurnAnswer> {
  const { store, log } = deps;
  const conversationId = input.conversationId ?? randomUUID();
  const warnings: string[] = [];

  let state: ConversationState = { summary: null, messages: [], tokensUsed: 0 };
  let memoryOk = true;
  try {
    state = await store.load(conversationId);
  } catch (err) {
    memoryOk = false;
    warnings.push(MEMORY_UNAVAILABLE);
    log.warn({ err: (err as Error).message }, 'Could not load conversation memory');
  }

  // Spending budget: a hard stop per conversation (protects against loops and abuse).
  if (state.tokensUsed >= deps.conversationTokenBudget) {
    throw new AppError(
      429,
      'CONVERSATION_BUDGET_EXCEEDED',
      'This conversation has reached its token limit. Start a new conversation.',
    );
  }

  const condensed = await condenseQuestion(deps.chatModel, log, state, input.question, stream?.signal);

  const answer = await answerQuestion(
    { retrieve: deps.retrieve, chatModel: deps.chatModel, log },
    condensed.standaloneQuestion,
    input.topK,
    stream && {
      signal: stream.signal,
      onEvent: (e) =>
        stream.onEvent(
          e.type === 'meta'
            ? {
                ...e,
                warnings: [...warnings, ...e.warnings],
                conversationId,
                standaloneQuestion: condensed.standaloneQuestion,
              }
            : e,
        ),
    },
  );

  const usage: Usage = {
    inputTokens: condensed.usage.inputTokens + answer.usage.inputTokens,
    outputTokens: condensed.usage.outputTokens + answer.usage.outputTokens,
  };

  if (memoryOk) {
    try {
      // Store what the USER asked (not the rewrite) and what they were shown.
      const count = await store.append(
        conversationId,
        [
          { role: 'user', content: input.question },
          { role: 'assistant', content: answer.answer },
        ],
        usage.inputTokens + usage.outputTokens,
      );
      const background = deps.background ?? ((task) => void task);
      if (count > 0) {
        background(
          summarizeIfNeeded({ store, chatModel: deps.chatModel, log }, conversationId).catch((err: unknown) =>
            log.warn({ err: (err as Error).message }, 'Conversation summarization failed'),
          ),
        );
      }
    } catch (err) {
      warnings.push(MEMORY_UNAVAILABLE);
      log.warn({ err: (err as Error).message }, 'Could not save conversation memory');
    }
  }

  log.info(
    {
      memory: {
        turn: state.messages.length / 2 + 1,
        rewritten: condensed.rewritten,
        hasSummary: state.summary !== null,
        tokensUsed: state.tokensUsed + usage.inputTokens + usage.outputTokens,
      },
    },
    'Chat turn',
  );

  return {
    ...answer,
    usage,
    warnings: [...new Set([...warnings, ...answer.warnings])],
    conversationId,
    standaloneQuestion: condensed.standaloneQuestion,
  };
}
