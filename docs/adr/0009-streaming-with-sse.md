# ADR-0009: Streaming answers with Server-Sent Events

- **Status:** Accepted
- **Date:** 2026-11-22

## Context
A RAG answer takes 2–5 seconds to generate. Users judge speed by when the first words appear
(time to first token, TTFT), not by total time. The answer is generated as structured JSON
(ADR-0008), and citations can only be verified once it is complete.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| **Server-Sent Events over a POST + fetch** | Plain HTTP, one direction (all we need), works through proxies and AWS ALB, easy to test | Browser `EventSource` is GET-only, so we parse the stream ourselves (~40 lines) |
| `EventSource` with GET `/chat/stream?q=…` | Built-in reconnects | The question ends up in URLs, logs and proxies (privacy). URL length limits |
| WebSockets | Two-way | Not needed for request→stream. Extra infrastructure (ALB/API Gateway config, sticky connections) |
| Long-polling | Works everywhere | Clunky, more requests, higher latency |

## Decision
- `POST /chat/stream` returns `text/event-stream` with the events `meta` (after retrieval),
  `delta` (answer text), `done` (the full verified answer, the same body as `POST /chat`), or `error`.
- The model streams JSON. A small incremental parser (`json-field-streamer.ts`) extracts the growing
  `answer` string, handling escapes split across chunks.
- **`delta` is a preview, `done` is authoritative.** Invalid citation markers are removed and the
  grounding check runs only on the complete answer, so the UI replaces the preview with `done.answer`.
- Validation errors stay normal 400 JSON responses. After the stream starts (status 200),
  failures are sent as an `error` event.
- Client disconnect → `AbortController` → the OpenAI request is aborted, so we stop paying for tokens.
- Heartbeat comment every 15 s (`: ping`) keeps idle connections alive behind load balancers
  (AWS ALB idle timeout is 60 s by default). `X-Accel-Buffering: no` and `Cache-Control: no-transform`
  stop proxies from buffering the stream.
- `POST /chat` (non-streaming) stays for the MCP server, evaluation scripts and simple clients.

## Consequences
- The UI shows text after retrieval plus the model's TTFT. TTFT is logged on every streamed call.
- A refusal streams no text: `meta` then `done` with `answerable: false`.
- A streamed preview can be replaced by a refusal (`no_valid_citations`) at the end. That's rare,
  and preferable to showing an unverified answer as final.
- Fastify's reply pipeline is bypassed (`reply.hijack()`), so the CORS headers are copied
  manually. Integration tests check this.
- On AWS: API Gateway REST APIs buffer responses (no streaming). Use an ALB or a
  Lambda Function URL with response streaming. This is recorded for the deployment phase.
