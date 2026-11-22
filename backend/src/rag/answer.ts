import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../errors.js';
import type { ChatModel } from '../llm/chat-model.js';
import { RAG_ANSWER, ragAnswerJsonSchema, ragAnswerSchema, type PromptVersion } from '../prompts/rag-answer.js';
import type { SearchResponse, SearchResult } from '../search/search.js';
import { resolveCitations } from './citations.js';

export const REFUSAL_MESSAGE = "I couldn't find the answer to that in the uploaded documents.";
const MAX_OUTPUT_TOKENS = 600;
const SNIPPET_CHARS = 300;

export type RefusalReason = 'no_sources' | 'not_in_sources' | 'no_valid_citations';

export interface Citation {
  /** The [n] marker used in the answer text. */
  n: number;
  chunkId: string;
  documentId: string;
  filename: string;
  heading: string | null;
  pageNumber: number | null;
  snippet: string;
}

export interface ChatAnswer {
  answer: string;
  answerable: boolean;
  refusalReason: RefusalReason | null;
  citations: Citation[];
  model: string;
  promptVersion: string;
  retrieval: { modeUsed: SearchResponse['modeUsed']; sources: number };
  warnings: string[];
}

export interface RagDeps {
  /** Hybrid search, injected so unit tests can fake retrieval without a database. */
  retrieve: (question: string, topK: number) => Promise<SearchResponse>;
  chatModel: ChatModel;
  log: FastifyBaseLogger;
  prompt?: PromptVersion;
}

const toCitation = (n: number, s: SearchResult): Citation => ({
  n,
  chunkId: s.chunkId,
  documentId: s.documentId,
  filename: s.filename,
  heading: s.heading,
  pageNumber: s.pageNumber,
  snippet: s.content.length > SNIPPET_CHARS ? `${s.content.slice(0, SNIPPET_CHARS)}…` : s.content,
});

/**
 * RAG = Retrieve → Augment → Generate (+ verify).
 *
 *   1. Retrieve: hybrid search finds the top-K chunks for the question.
 *   2. Augment:  the versioned prompt numbers the chunks [1]..[K] around the question.
 *   3. Generate: the LLM returns JSON {answerable, answer, citations} (structured output).
 *   4. Verify:   validate the JSON, check citation numbers against the real sources, and
 *                refuse unless the answer is grounded in at least one of them.
 */
export async function answerQuestion(deps: RagDeps, question: string, topK: number): Promise<ChatAnswer> {
  const { retrieve, chatModel, log } = deps;
  const prompt = deps.prompt ?? RAG_ANSWER;
  const started = performance.now();

  const retrieval = await retrieve(question, topK);
  const sources = retrieval.results;

  const result = (fields: Pick<ChatAnswer, 'answer' | 'answerable' | 'refusalReason' | 'citations'>): ChatAnswer => {
    // The question and answer may contain personal data: log shape and outcome only.
    log.info(
      {
        rag: {
          promptVersion: prompt.id,
          model: chatModel.model,
          sources: sources.length,
          answerable: fields.answerable,
          refusalReason: fields.refusalReason,
          citations: fields.citations.length,
          durationMs: Math.round(performance.now() - started),
        },
      },
      'RAG answer',
    );
    return {
      ...fields,
      model: chatModel.model,
      promptVersion: prompt.id,
      retrieval: { modeUsed: retrieval.modeUsed, sources: sources.length },
      warnings: retrieval.warnings,
    };
  };
  const refuse = (refusalReason: RefusalReason) =>
    result({ answer: REFUSAL_MESSAGE, answerable: false, refusalReason, citations: [] });

  // Nothing retrieved: don't pay for an LLM call that can only say "I don't know".
  if (sources.length === 0) return refuse('no_sources');

  const { json } = await chatModel.completeJson({
    messages: prompt.build(question, sources),
    schemaName: 'rag_answer',
    jsonSchema: ragAnswerJsonSchema(),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  // Structured outputs make the shape very likely, not guaranteed (other providers, fakes,
  // future schema drift), so validate like any other untrusted input.
  const parsed = ragAnswerSchema.safeParse(json);
  if (!parsed.success) {
    log.warn({ issues: parsed.error.issues.length }, 'Chat model returned JSON that does not match the schema');
    throw new AppError(502, 'CHAT_INVALID_RESPONSE', 'The language model returned an unusable answer. Try again.');
  }
  if (!parsed.data.answerable || !parsed.data.answer.trim()) return refuse('not_in_sources');

  // Grounding check: an answer that cites no real source is not trustworthy, so refuse it.
  const { text, cited } = resolveCitations(parsed.data.answer, sources.length);
  if (cited.length === 0) return refuse('no_valid_citations');

  return result({
    answer: text,
    answerable: true,
    refusalReason: null,
    citations: cited.map((n) => toCitation(n, sources[n - 1]!)),
  });
}
