# AI Knowledge Assistant

A local AI assistant that answers questions about your internal documents (PDF, Markdown)
with **grounded answers and citations**, built on Retrieval-Augmented Generation (RAG).

> Status: **Milestone 8 — RAG chat with citations.** `POST /chat` retrieves chunks with hybrid search, asks the LLM for a structured answer with `[n]` citations, verifies them, and refuses when the documents don't contain the answer. The web UI has a Dashboard (upload, documents, chunk viewer) and a Search page.

## What it will do

- Upload PDF / Markdown documents → extract, chunk, embed, store in PostgreSQL + pgvector
- Hybrid search (vector similarity + full-text) fused with Reciprocal Rank Fusion
- RAG chat with streaming answers (SSE) and source citations
- Per-user conversation memory in Redis (sliding window + summaries, token budgets)
- LangChain / LangGraph workflows, an MCP server for Claude, and an agent with tool-call limits
- An evaluation suite (golden Q&A set) plus logging of LLM cost, latency, and tokens

## Repository layout

```
ai-knowledge-assistant/
├── backend/        Fastify + TypeScript API (ingestion, retrieval, RAG, MCP)
├── frontend/       Next.js (App Router) + Tailwind UI
├── evaluation/     Golden dataset + evaluation scripts
├── documents/      Sample documents used for demos and evaluation
├── prompts/        Versioned prompt templates
├── docs/           Architecture, ADRs, learning notes
├── docker-compose.yml   Postgres + pgvector, Redis, migrate job, API
├── .env.example
└── CLAUDE.md       Working rules for Claude Code in this repo
```

`frontend/` and `backend/` are **independent packages**, each with its own
`package.json` and lockfile. They talk only over HTTP and SSE. See
[ADR-0001](docs/adr/0001-monorepo-structure.md).

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 24 LTS (see `.nvmrc`) | `node -v` |
| npm | 10+ | `npm -v` |
| Docker + Compose v2 | recent | `docker compose version` |

```bash
nvm install   # reads .nvmrc
nvm use
```

## Setup

```bash
cp .env.example .env                     # then set OPENAI_API_KEY (or EMBEDDING_PROVIDER=fake to try offline)
cp frontend/.env.example frontend/.env.local
```

### Option A: everything in Docker (closest to production)

```bash
docker compose up -d --build     # postgres, redis, migrate (one-shot), api
docker compose ps                # api/postgres/redis "healthy", migrate "exited (0)"
curl localhost:4000/health       # liveness:  is the process up?
curl localhost:4000/ready        # readiness: are Postgres and Redis reachable?

cd frontend && npm install && npm run dev   # http://localhost:3000
```

### Option B: infrastructure in Docker, API on your machine (hot reload)

```bash
docker compose up -d postgres redis
cd backend
npm install
npm run migrate                  # apply SQL migrations to localhost:5433
npm run dev                      # http://localhost:4000
```

Only one API can use port 4000: run `docker compose stop api` before `npm run dev`.

### Useful commands

```bash
docker compose logs -f api                      # follow API logs
docker compose exec postgres psql -U assistant -d knowledge   # SQL shell
docker compose exec redis redis-cli             # Redis shell
docker compose down                             # stop (data is kept in volumes)
docker compose down -v                          # stop AND delete all data
```

| Service | Host port | Notes |
|---|---|---|
| API | 4000 | `/health`, `/ready` |
| PostgreSQL | **5433** | 5433, not 5432, to avoid clashing with a local Postgres |
| Redis | 6379 | append-only persistence |

### Explore embeddings

```bash
cd backend
npm run embed:playground                                  # sentences → vectors → similarity
npm run embed:search -- "How many days can I carry over?" # nearest chunks in pgvector
EMBEDDING_PROVIDER=fake npm run embed:playground          # offline contrast: word overlap only
```

### Try search

```bash
curl -s localhost:4000/search -H 'content-type: application/json' \
  -d '{"query":"How many vacation days can I carry over?","topK":3}'
# mode: "hybrid" (default) | "vector" | "keyword"
```

Without an `OPENAI_API_KEY`, hybrid search falls back to keyword-only and returns a warning.

### Ask a question

```bash
curl -s localhost:4000/chat -H 'content-type: application/json' \
  -d '{"question":"How many vacation days can I carry over?"}'
```

Needs `OPENAI_API_KEY` (chat model: `CHAT_MODEL`, default `gpt-4.1-mini`). To try it without a key:
`EMBEDDING_PROVIDER=fake CHAT_PROVIDER=fake docker compose up -d api`. The fake model copies a
sentence from the best source, so it shows the wiring but not real answers.

### Tests

```bash
cd backend
npm test                    # unit tests, no Docker needed (dependencies are faked)
npm run test:integration    # against real Postgres (needs: docker compose up -d postgres)
```

## Documentation

- [Architecture](docs/architecture.md)
- [API reference](docs/api.md)
- [Architecture Decision Records](docs/adr/)
- [Learning notes](docs/learning-notes/)

## Roadmap

1. ✅ Repository and project setup
2. ✅ Backend foundation (Fastify)
3. ✅ Frontend foundation (Next.js)
4. ✅ Docker Compose, PostgreSQL, Redis
5. ✅ Document ingestion and chunking (API + Dashboard UI)
6. ✅ Embeddings and vector storage
7. ✅ Hybrid search (vector + keyword, RRF) + Search UI
8. ✅ RAG chat and citations
9. Streaming responses
10. Redis conversation memory and token budgets
11. LangChain vs. handwritten RAG
12. LangGraph workflow and human-in-the-loop
13. MCP server and Claude integration
14. AI agent with tool-call limits
15. LangSmith tracing and evaluation
16. Testing, documentation, final demo
