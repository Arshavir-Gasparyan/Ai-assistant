# ADR-0004: node-postgres with plain SQL, and a minimal SQL migration runner

- **Status:** Accepted
- **Date:** 2026-11-20

## Context
The backend needs to talk to Postgres, and the schema has to evolve milestone by milestone.
Much of the important logic in this project is SQL: vector distance operators (`<=>`), HNSW
indexes, `tsvector` full-text search, RRF fusion. That SQL should stay visible.

## Options considered
**Client / query layer**
1. **`pg` (node-postgres) + handwritten parameterized SQL.** The most widely used driver.
   Nothing hidden. pgvector operators are just SQL.
2. **Query builder (Kysely) or ORM (Drizzle, Prisma).** Typed queries, but vector and FTS
   support ranges from partial (Drizzle) to raw-SQL-only (Prisma). It adds an abstraction
   exactly where we want to learn what happens.

**Migrations**
1. **Tiny custom runner (~60 lines, `src/db/migrate.ts`)**: ordered `.sql` files, a
   `schema_migrations` table, one transaction per file, and an advisory lock.
2. **node-pg-migrate / dbmate / Prisma Migrate.** More features (down migrations, CLI).

## Decision
`pg` with parameterized SQL, plus the custom SQL migration runner. In Docker, migrations run
as a **one-shot `migrate` service** that the API waits for (`service_completed_successfully`),
not inside API startup.

## Consequences
- Every query is readable SQL. We write row types by hand (or with Zod) instead of generating them.
- Forward-only migrations: to undo something, write a new migration.
- Running migrations as a separate job mirrors AWS (e.g. an ECS task before deploying the
  service), and prevents N API replicas from migrating at once. The advisory lock guards that anyway.
- If the migration needs grow (down migrations, many contributors), switch to node-pg-migrate.
  It reads the same kind of SQL files.
