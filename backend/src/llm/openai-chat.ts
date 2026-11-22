import type { FastifyBaseLogger } from 'fastify';
import OpenAI from 'openai';
import { AppError } from '../errors.js';
import type { ChatModel, CompletionOptions, JsonCompletionRequest } from './chat-model.js';
import { logLlmCall } from './usage.js';

/** Reasoning models (o-series, gpt-5*) reject `temperature` other than the default. */
const isReasoningModel = (model: string) => /^(o\d|gpt-5)/.test(model);

const invalidResponse = (why: string) =>
  new AppError(502, 'CHAT_INVALID_RESPONSE', `The language model returned an unusable answer (${why}). Try again.`);

/** What both paths (streaming and not) collect before validation. */
interface RawReply {
  content: string;
  finishReason: string | null;
  refusal: string | null;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * OpenAI chat via the Chat Completions API. Chosen over the newer Responses API because
 * it is the de-facto "OpenAI-compatible" protocol: Ollama, vLLM, LM Studio etc. speak it,
 * so the same code can talk to a local model by changing `baseURL`.
 */
export function createOpenAIChatModel(
  apiKey: string,
  model: string,
  log: FastifyBaseLogger,
  clientOptions: Partial<ConstructorParameters<typeof OpenAI>[0]> = {},
): ChatModel {
  const client = new OpenAI({ apiKey, maxRetries: 2, timeout: 60_000, ...clientOptions });

  const params = ({ messages, schemaName, jsonSchema, maxOutputTokens }: JsonCompletionRequest) => ({
    model,
    messages,
    max_completion_tokens: maxOutputTokens,
    // temperature 0 = always pick the most likely next token: as repeatable as possible,
    // which is what you want for answering from documents (and for evaluation).
    ...(isReasoningModel(model) ? {} : { temperature: 0 }),
    // Structured outputs: with strict: true the model can ONLY produce JSON matching the schema.
    response_format: {
      type: 'json_schema' as const,
      json_schema: { name: schemaName, strict: true, schema: jsonSchema },
    },
  });

  async function requestOnce(request: JsonCompletionRequest, signal?: AbortSignal): Promise<RawReply> {
    const response = await client.chat.completions.create(params(request), { signal });
    const choice = response.choices[0];
    return {
      content: choice?.message.content ?? '',
      finishReason: choice?.finish_reason ?? null,
      refusal: choice?.message.refusal ?? null,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }

  /**
   * stream: true → the HTTP response is itself an SSE stream of small "chunk" objects, each
   * with a few characters of the reply in `choices[0].delta.content`. include_usage adds a
   * final chunk with token counts (otherwise streamed calls report no usage at all).
   */
  async function requestStreaming(
    request: JsonCompletionRequest,
    onToken: (chunk: string) => void,
    onFirstToken: () => void,
    signal?: AbortSignal,
  ): Promise<RawReply> {
    const stream = await client.chat.completions.create(
      { ...params(request), stream: true, stream_options: { include_usage: true } },
      { signal },
    );
    const reply: RawReply = { content: '', finishReason: null, refusal: null, usage: { inputTokens: 0, outputTokens: 0 } };
    for await (const chunk of stream) {
      if (chunk.usage) {
        reply.usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
      }
      const choice = chunk.choices[0];
      if (!choice) continue;
      const text = choice.delta.content;
      if (text) {
        if (!reply.content) onFirstToken();
        reply.content += text;
        onToken(text);
      }
      if (choice.delta.refusal) reply.refusal = (reply.refusal ?? '') + choice.delta.refusal;
      if (choice.finish_reason) reply.finishReason = choice.finish_reason;
    }
    return reply;
  }

  return {
    provider: 'openai',
    model,

    async completeJson(request, options: CompletionOptions = {}) {
      const { onToken, signal } = options;
      const startedAt = performance.now();
      let timeToFirstTokenMs: number | undefined;

      let reply: RawReply;
      try {
        reply = onToken
          ? await requestStreaming(request, onToken, () => (timeToFirstTokenMs = performance.now() - startedAt), signal)
          : await requestOnce(request, signal);
      } catch (err) {
        if (signal?.aborted) {
          // The client went away. Usage is unknown (the final usage chunk never arrived).
          log.info({ latencyMs: Math.round(performance.now() - startedAt) }, 'Chat request aborted by client');
          throw new AppError(499, 'CLIENT_CLOSED_REQUEST', 'The request was cancelled');
        }
        // Same rule as embeddings: status/code only, the provider message can echo key fragments.
        const details =
          err instanceof OpenAI.APIError
            ? { status: err.status, code: err.code, type: err.type }
            : { error: (err as Error).name };
        log.error(details, 'Chat request failed');
        throw new AppError(502, 'CHAT_FAILED', 'The language model is unavailable. Try again later.');
      }

      logLlmCall(log, {
        provider: 'openai',
        model, // the configured name, so pricing lookup works (responses carry a dated name)
        operation: 'chat',
        ...reply.usage,
        latencyMs: performance.now() - startedAt,
        ...(onToken && { streamed: true, timeToFirstTokenMs }),
      });

      // 'length' = hit max_completion_tokens mid-answer: the JSON is cut off and unparseable.
      if (reply.finishReason === 'length') throw invalidResponse('answer was too long');
      // The provider's own safety refusal (not our "not in the documents" refusal).
      if (reply.refusal) throw invalidResponse('provider refused');
      if (!reply.content) throw invalidResponse('empty');

      try {
        return { json: JSON.parse(reply.content), usage: reply.usage };
      } catch {
        throw invalidResponse('not JSON');
      }
    },
  };
}
