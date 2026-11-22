/**
 * The app's view of a chat LLM. Like `Embedder`, the rest of the code depends only on this
 * interface, so providers (OpenAI, Claude, Ollama, a fake for tests) are interchangeable.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface JsonCompletionRequest {
  messages: ChatMessage[];
  /** A short identifier for the schema, e.g. "rag_answer" (some providers require one). */
  schemaName: string;
  /**
   * JSON Schema the reply MUST match ("structured outputs"). The provider constrains
   * generation to this shape, so we get parseable JSON instead of hoping the model complies.
   */
  jsonSchema: Record<string, unknown>;
  /** Hard cap on generated tokens: bounds cost and latency. */
  maxOutputTokens: number;
}

export interface JsonCompletion {
  /** Parsed JSON. Still `unknown`: callers must validate it (the model is not trusted). */
  json: unknown;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ChatModel {
  provider: 'openai' | 'anthropic' | 'ollama' | 'fake';
  model: string;
  completeJson(request: JsonCompletionRequest): Promise<JsonCompletion>;
}
