# ADR-0011: MCP server as a thin stdio client of the HTTP API

- **Status:** Accepted
- **Date:** 2026-11-22

## Context
The task requires an MCP server with the tools `search_documents` and `ask_question` over stdio, so
MCP clients (Claude Desktop, Claude Code) can use the knowledge base. With stdio, the client
starts the server as a child process. Its configuration (command, args, env) lives in a file on the
user's machine.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| **A. Thin client of the HTTP API** | One implementation of retrieval, prompts, guardrails, memory and LLM logging. **No secrets** in the client config (only the API URL). Small | The API must be running |
| B. Import backend modules, connect to Postgres/Redis/OpenAI directly | Works without the API process | Duplicate wiring. DB credentials **and the OpenAI key in `claude_desktop_config.json`**. LLM calls logged in two places |
| C. HTTP transport (Streamable HTTP) inside the API | Remote clients, one process | The task specifies stdio. Needs auth before it could be exposed. A good fit for the AWS phase |

## Decision
Option A: a separate package `mcp-server/` (third independent package, per ADR-0001) using the
official TypeScript SDK (`@modelcontextprotocol/sdk` 1.32), `McpServer.registerTool` with Zod input
**and output** schemas, and stdio transport.

- `search_documents` → `POST /search`. `ask_question` → `POST /chat`, with optional `conversationId`
  so follow-ups use the Redis memory (ADR-0010).
- Each result returns readable `content` (text for the model) **and** `structuredContent`
  (typed JSON validated against the output schema).
- Annotations: `readOnlyHint: true`, `openWorldHint: false` (the tools only read our own documents).
- Failures (API down, timeout, 503) return `isError: true` results with a clear message, so the
  client model can explain them instead of the call failing as a protocol error.
- stdout is reserved for JSON-RPC. Diagnostics go to stderr.
- Targets Node 20+ (clients run it with whatever `node` they find).

## Consequences
- The MCP path gets every backend guarantee for free: refusal, citation checks, input limits, token
  budgets, `logLlmCall` cost logs.
- **Indirect prompt injection:** passages returned to the client model are untrusted document text.
  Our own answer prompt defends against it (ADR-0008), but the *client's* model reads raw passages from
  `search_documents`. The tool descriptions warn it; real protection needs trusted document sources.
- For AWS: switch to (or add) the Streamable HTTP transport behind authentication, so remote clients can
  connect without running a local process.
