import type { Redis } from '../redis/client.js';

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationState {
  /** LLM-written summary of messages that slid out of the window, or null. */
  summary: string | null;
  /** Recent messages, oldest first. */
  messages: StoredMessage[];
  /** Total LLM tokens (in + out) this conversation has used: for the spending budget. */
  tokensUsed: number;
}

/**
 * Where conversations live. The app depends on this interface; production uses Redis,
 * unit tests use the in-memory version.
 */
export interface ConversationStore {
  load(id: string): Promise<ConversationState>;
  /** Append messages and add to the token counter. Returns the new message count. */
  append(id: string, messages: StoredMessage[], tokens: number): Promise<number>;
  /** Replace the summary and drop the `dropCount` OLDEST messages (the ones it now covers). */
  compact(id: string, summary: string, dropCount: number): Promise<void>;
  clear(id: string): Promise<void>;
}

/**
 * Redis layout, three keys per conversation:
 *
 *   conv:<id>:messages   LIST of JSON messages (RPUSH appends to the end = newest last)
 *   conv:<id>:summary    STRING
 *   conv:<id>:tokens     STRING used as a counter (INCRBY is atomic)
 *
 * Every write refreshes the TTL on all three, so a conversation expires after
 * `ttlSeconds` of INACTIVITY (sliding expiry). Expiry is also our retention policy:
 * conversation text may contain personal data, so it must not live forever.
 */
export function createRedisConversationStore(redis: Redis, ttlSeconds: number): ConversationStore {
  const keys = (id: string) => ({
    messages: `conv:${id}:messages`,
    summary: `conv:${id}:summary`,
    tokens: `conv:${id}:tokens`,
  });

  return {
    async load(id) {
      const k = keys(id);
      const [messages, summary, tokens] = await Promise.all([
        redis.lRange(k.messages, 0, -1),
        redis.get(k.summary),
        redis.get(k.tokens),
      ]);
      return {
        summary: summary ?? null,
        messages: messages.map((m) => JSON.parse(m) as StoredMessage),
        tokensUsed: Number(tokens ?? 0),
      };
    },

    async append(id, messages, tokens) {
      const k = keys(id);
      // MULTI/EXEC: the commands run together, so no other request sees a half-written turn.
      const tx = redis.multi();
      // RPUSH with no values is an error; LLEN returns the same thing (the list length).
      const first =
        messages.length > 0 ? tx.rPush(k.messages, messages.map((m) => JSON.stringify(m))) : tx.lLen(k.messages);
      const results = await first
        .incrBy(k.tokens, tokens)
        .expire(k.messages, ttlSeconds)
        .expire(k.tokens, ttlSeconds)
        .expire(k.summary, ttlSeconds)
        .exec();
      return Number(results[0]);
    },

    async compact(id, summary, dropCount) {
      const k = keys(id);
      // LTRIM keeps the range [dropCount, end]: removes exactly the messages that were
      // summarized, even if new ones were appended meanwhile (they are at the end).
      await redis
        .multi()
        .set(k.summary, summary, { EX: ttlSeconds })
        .lTrim(k.messages, dropCount, -1)
        .exec();
    },

    async clear(id) {
      const k = keys(id);
      await redis.del([k.messages, k.summary, k.tokens]);
    },
  };
}

/** For unit tests: same behaviour, no Redis, no expiry. */
export function createInMemoryConversationStore(): ConversationStore & { data: Map<string, ConversationState> } {
  const data = new Map<string, ConversationState>();
  const get = (id: string) => data.get(id) ?? { summary: null, messages: [], tokensUsed: 0 };
  return {
    data,
    async load(id) {
      const s = get(id);
      return { ...s, messages: [...s.messages] };
    },
    async append(id, messages, tokens) {
      const s = get(id);
      data.set(id, { ...s, messages: [...s.messages, ...messages], tokensUsed: s.tokensUsed + tokens });
      return s.messages.length + messages.length;
    },
    async compact(id, summary, dropCount) {
      const s = get(id);
      data.set(id, { ...s, summary, messages: s.messages.slice(dropCount) });
    },
    async clear(id) {
      data.delete(id);
    },
  };
}
