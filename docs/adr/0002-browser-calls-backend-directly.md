# ADR-0002: Browser calls the backend API directly (CORS), not through a Next.js proxy

- **Status:** Accepted
- **Date:** 2026-11-20

## Context
The frontend (Next.js, `localhost:3000`) needs data from the backend (Fastify, `localhost:4000`):
JSON endpoints and, from Milestone 9, a long-lived Server-Sent Events stream for chat answers.
These are different origins, so the browser enforces CORS.

## Options considered
1. **Browser → backend directly.** The backend allow-lists the frontend origin with CORS.
   - Pros: one network hop. SSE streams straight from the backend with no buffering risk.
     Matches the requirement that the frontend talk to the backend over HTTP and SSE. The
     backend stays the single API for the UI, the MCP server, and evaluation scripts.
   - Cons: the backend URL is public (it holds no secrets anyway), and CORS must be configured.
2. **Backend-for-Frontend: browser → Next.js route handlers/server actions → backend.**
   - Pros: no CORS, the backend can stay private, and you can add auth/session handling in Next.
   - Cons: every endpoint is written twice, SSE must be proxied (easy to break by buffering),
     two hops add latency, and the Next.js server becomes part of the AI request path.
3. **Next.js `rewrites` to the backend.** Same origin without hand-written proxies, but it
   still proxies SSE through Next, and it hides the real architecture.

## Decision
Option 1. The backend registers `@fastify/cors` with an explicit allow-list from `CORS_ORIGINS`
(default `http://localhost:3000`). The frontend calls the API via `src/lib/api.ts` using
`NEXT_PUBLIC_API_URL`.

## Consequences
- No secrets may ever live in the frontend. Only `NEXT_PUBLIC_API_URL` is exposed.
- `NEXT_PUBLIC_*` values are inlined at **build time**. For AWS, the frontend must be built
  with the production API URL (or fetch its config at runtime).
- If we add user authentication later, revisit this: a BFF makes httpOnly cookie sessions simpler.
