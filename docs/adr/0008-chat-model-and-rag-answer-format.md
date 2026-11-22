# ADR-0008: Chat model and RAG answer format

- **Status:** Accepted
- **Date:** 2026-11-22

## Context
`POST /chat` needs an LLM to write answers from retrieved chunks. Requirements from the task:
citations, refusal when the documents don't contain the answer, JSON-schema structured outputs,
versioned prompts, logging of every call (tokens, latency, cost), Claude as an alternative,
and an Ollama comparison later. Streaming comes next (Milestone 9).

## Decisions

### 1. Model: OpenAI `gpt-4.1-mini` by default, configurable with `CHAT_MODEL`
| Option | Why / why not |
|---|---|
| **gpt-4.1-mini** | Cheap, fast, non-reasoning, so the first token arrives quickly (matters for streaming). Supports temperature 0 and strict structured outputs. Same key as embeddings |
| gpt-5-mini | Similar price, but a reasoning model: hidden reasoning tokens add latency and cost, and no temperature control. Fine for harder questions. Selectable via `CHAT_MODEL` |
| Claude (Haiku / Sonnet) | Excellent at following instructions and citing. Needs a second key and SDK. Fits behind the same `ChatModel` interface, added for the comparison |
| Local via Ollama | Free and private, lower quality. Planned as a comparison (same API, see 2) |

Prices are in `src/llm/usage.ts` (checked 2026-11-22; sources disagreed for gpt-4.1-mini, so verify).

### 2. API: OpenAI Chat Completions (not the newer Responses API)
Chat Completions is the de-facto "OpenAI-compatible" protocol. Ollama, vLLM and LM Studio expose it,
so the Ollama comparison is a `baseURL` change.

### 3. Output: structured JSON `{ answerable, answer, citations }` with inline `[n]` markers
- `answerable` makes refusal an explicit field instead of parsing "I don't know" from free text.
- Inline `[n]` markers tie each statement to a source. The server treats the markers in the text
  as the truth: it drops numbers that don't match a retrieved source and **refuses any answer with
  no valid citation** (grounding check).
- Zod schema → JSON Schema (`z.toJSONSchema`), sent with `strict: true`. The reply is still
  validated with Zod, because the model is untrusted and not every provider enforces schemas.
- Streaming (Milestone 9) will stream the JSON and extract the `answer` field as it grows.

### 4. Refusal happens at three levels
1. Retrieval finds nothing → refuse without calling the LLM (no cost).
2. The model sets `answerable: false` (prompt rule: use only the sources, don't guess).
3. The answer cites no real source → refuse.

### 5. Prompts are versioned TypeScript modules in `backend/src/prompts/`
Not loose files in the root `prompts/` folder: the Docker image is built from `backend/` only, and
typed modules ship with the build (locally and on AWS) with no file I/O. Rule: never edit a
published version. Add `v2`, switch `RAG_ANSWER`, and compare both with the eval set. Every answer
returns and logs `promptVersion`.

### 6. Prompt-injection defence
Sources are wrapped in `<source id="n" file=… section=…>` tags with `<` escaped, so a document
can't close its tag and pose as instructions. The system prompt says sources are untrusted data.
This reduces the risk but can't eliminate it. The grounding check and the "answer only from sources" rule limit the damage.

## Consequences
- One OpenAI key enables everything. Without a key, `/chat` returns 503 and the rest works.
  `CHAT_PROVIDER=fake` gives deterministic extractive answers for tests and demos.
- temperature 0 + versioned prompts make answers repeatable enough to evaluate (Milestone 15).
- The grounding check can refuse a correct answer that the model forgot to cite. The eval set
  will show how often that happens.
- No conversation history yet (Milestone 10), and no token-budget enforcement beyond `topK ≤ 10`
  and `max_completion_tokens = 600`.
