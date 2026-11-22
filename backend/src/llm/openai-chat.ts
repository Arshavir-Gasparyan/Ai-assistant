import type { FastifyBaseLogger } from 'fastify';
import OpenAI from 'openai';
import { AppError } from '../errors.js';
import type { ChatModel } from './chat-model.js';
import { logLlmCall } from './usage.js';

/** Reasoning models (o-series, gpt-5*) reject `temperature` other than the default. */
const isReasoningModel = (model: string) => /^(o\d|gpt-5)/.test(model);

const invalidResponse = (why: string) =>
  new AppError(502, 'CHAT_INVALID_RESPONSE', `The language model returned an unusable answer (${why}). Try again.`);

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

  return {
    provider: 'openai',
    model,

    async completeJson({ messages, schemaName, jsonSchema, maxOutputTokens }) {
      const startedAt = performance.now();

      let response: OpenAI.ChatCompletion;
      try {
        response = await client.chat.completions.create({
          model,
          messages,
          max_completion_tokens: maxOutputTokens,
          // temperature 0 = always pick the most likely next token: as repeatable as possible,
          // which is what you want for answering from documents (and for evaluation).
          ...(isReasoningModel(model) ? {} : { temperature: 0 }),
          // Structured outputs: with strict: true the model can ONLY produce JSON matching the schema.
          response_format: {
            type: 'json_schema',
            json_schema: { name: schemaName, strict: true, schema: jsonSchema },
          },
        });
      } catch (err) {
        // Same rule as embeddings: status/code only, the provider message can echo key fragments.
        const details =
          err instanceof OpenAI.APIError
            ? { status: err.status, code: err.code, type: err.type }
            : { error: (err as Error).name };
        log.error(details, 'Chat request failed');
        throw new AppError(502, 'CHAT_FAILED', 'The language model is unavailable. Try again later.');
      }

      const usage = {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      };
      logLlmCall(log, {
        provider: 'openai',
        model, // the configured name, so pricing lookup works (response.model has a date suffix)
        operation: 'chat',
        ...usage,
        latencyMs: performance.now() - startedAt,
      });

      const choice = response.choices[0];
      // 'length' = hit max_completion_tokens mid-answer: the JSON is cut off and unparseable.
      if (choice?.finish_reason === 'length') throw invalidResponse('answer was too long');
      // The provider's own safety refusal (not our "not in the documents" refusal).
      if (choice?.message.refusal) throw invalidResponse('provider refused');
      if (!choice?.message.content) throw invalidResponse('empty');

      try {
        return { json: JSON.parse(choice.message.content), usage };
      } catch {
        throw invalidResponse('not JSON');
      }
    },
  };
}
