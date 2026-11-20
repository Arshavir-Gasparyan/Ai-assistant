# AI Knowledge Assistant

A local AI assistant that answers questions about your internal documents (PDF, Markdown)
with **grounded answers and citations**, built on Retrieval-Augmented Generation (RAG).

> Status: **Milestone 3 — frontend foundation.** API (`/health`) plus a Next.js UI shell that talks to it.

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
├── docker-compose.yml   (Milestone 4)
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
cp .env.example .env   # then fill in values as milestones require them
```

### Backend (Fastify API)

```bash
cd backend
npm install
npm run dev        # http://localhost:4000, reloads on change, reads ../.env if present
npm test           # unit tests (Vitest)
npm run typecheck
npm run build && npm start   # compiled production-style run
```

Check it: `curl localhost:4000/health`

### Frontend (Next.js)

```bash
cd frontend
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev                  # http://localhost:3000
```

With both running, the header should show a green **API online** indicator.

Docker run instructions come with Milestone 4.

## Documentation

- [Architecture](docs/architecture.md)
- [Architecture Decision Records](docs/adr/)
- [Learning notes](docs/learning-notes/)

## Roadmap

1. ✅ Repository and project setup
2. ✅ Backend foundation (Fastify)
3. ✅ Frontend foundation (Next.js)
4. Docker Compose, PostgreSQL, Redis
5. Document ingestion and chunking
6. Embeddings and vector storage
7. Hybrid search
8. RAG chat and citations
9. Streaming responses
10. Redis conversation memory and token budgets
11. LangChain vs. handwritten RAG
12. LangGraph workflow and human-in-the-loop
13. MCP server and Claude integration
14. AI agent with tool-call limits
15. LangSmith tracing and evaluation
16. Testing, documentation, final demo
