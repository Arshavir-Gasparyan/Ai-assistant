# ADR-0010: Conversation memory (Redis) and token budgets

- **Status:** Accepted
- **Date:** 2026-11-22

## Context
Follow-up questions ("and how many can I carry over?") don't make sense without the earlier turns.
Memory must stay bounded: every remembered token is re-sent (cost, latency, context limit).
The task asks for Redis memory with a sliding window + summary, and token budgets.

## Decisions

### 1. Storage: Redis, three keys per conversation, sliding TTL
`conv:<id>:messages` (list), `conv:<id>:summary` (string), `conv:<id>:tokens` (counter).
Every write refreshes a TTL (`MEMORY_TTL_SECONDS`, default 24h). The TTL is also the **retention
policy**: conversation text can contain personal data, so it expires, and `DELETE /conversations/:id`
removes it immediately ("New conversation" in the UI calls it).
Alternatives: Postgres (durable, but we don't need history beyond a session, and it would need a
cleanup job), in-process memory (lost on restart, breaks with more than one API instance on AWS).

### 2. Identity: server-generated `conversationId` (UUID)
Returned with the first answer and sent back by the client. Random UUIDs are unguessable, which
is enough locally. **On AWS this must be tied to an authenticated user.** The id is validated as a
UUID, so it can't be used to build other Redis keys.

### 3. Sliding window + summary
The last 6 messages (3 exchanges) are kept verbatim. When more than 10 are stored, the oldest are
folded into an LLM-written summary (`summarize-conversation@v1`), in the background after the answer
is sent, so the user doesn't wait. Compaction drops exactly the summarized messages (`LTRIM n -1`),
so turns that arrive during summarization aren't lost.

### 4. Memory is used to REWRITE the question, not added to the answer prompt
| Option | Problem |
|---|---|
| Put history into the answer prompt only | Retrieval still searches for "and how many can I carry over?", which finds the wrong chunks |
| **Condense the follow-up into a standalone question (`condense-question@v1`), then normal RAG** | One extra small LLM call per follow-up (skipped for the first question) |

The rewrite drives both retrieval and the answer. `rag-answer@v1` is unchanged, and the
standalone question is returned (`standaloneQuestion`) and shown in the UI, so memory is visible
and debuggable. We store what the user actually typed, not the rewrite.

### 5. Token budgets
- **Prompt budget:** sources ≤ 3,000 estimated tokens (lowest-ranked dropped first), history ≤
  1,500 (oldest dropped first), output ≤ 600 (`max_completion_tokens`). Estimated as chars/4
  (no tokenizer dependency; the real counts come back in `usage`).
- **Spending budget:** each conversation may use `CONVERSATION_TOKEN_BUDGET` LLM tokens (default
  100k, about $0.05 with gpt-4.1-mini). Then the API returns `429 CONVERSATION_BUDGET_EXCEEDED`.
  Summarization tokens count too.

### 6. Degradation
If Redis is unavailable (`disableOfflineQueue` makes commands fail fast instead of hanging), chat
still answers without memory and returns a warning. The spending budget then fails open.
The question rewrite falls back to the original question if it fails.

## Consequences
- Follow-ups work. Cost per follow-up is roughly +1 small LLM call.
- Memory is per conversation and expires. There's no cross-session history or "my conversations" list.
- The per-conversation budget doesn't stop someone from starting many conversations. A per-user or per-IP
  rate limit belongs with authentication (AWS phase).
- A bad rewrite can mislead retrieval. The UI shows it, and the evaluation (M15) should include follow-up cases.
