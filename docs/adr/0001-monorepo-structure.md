# ADR-0001: Single repository, independent frontend and backend packages

- **Status:** Accepted
- **Date:** 2026-11-20

## Context
The project has a Next.js frontend, a Fastify backend (which also hosts the MCP server),
evaluation scripts, sample documents, and prompt templates. The backend must run as a Docker
container and later move to AWS. The frontend runs locally via `next dev`.

## Options considered
1. **Separate repositories per app.** Clean isolation, but cross-cutting changes (an API
   change plus its UI) need two PRs. Too much overhead for a single developer.
2. **Monorepo with npm/pnpm workspaces (or Turborepo/Nx).** Shared dependencies and a shared
   types package. However, hoisted `node_modules` complicates the backend Dockerfile, and the
   tooling adds concepts that teach nothing about AI.
3. **One repo, independent packages.** Each of `frontend/` and `backend/` has its own
   `package.json` and lockfile. No workspace tooling.

## Decision
Option 3. The backend Docker build context is simply `backend/`. API contracts are shared by
convention (Zod schemas in the backend, mirrored types in the frontend) instead of a shared package.

## Consequences
- Simple mental model and simple Dockerfiles.
- Run `npm install` separately in each package.
- API types may drift. If that becomes painful, revisit with a workspace plus a shared
  `contracts` package, or generate types from an OpenAPI spec.
