# ADR-0003: PostgreSQL + pgvector as the vector store

- **Status:** Accepted
- **Date:** 2026-11-20

## Context
RAG needs to store text chunks with their embedding vectors and find the chunks most
similar to a question's vector. We also need keyword search (for hybrid search),
document metadata, and transactional re-ingestion (replace a document's chunks atomically).
It must run locally in Docker and move to AWS later. The task requires pgvector with an HNSW index.

## Options considered
1. **PostgreSQL + pgvector.** Vectors are a column type next to normal columns.
   - Pros: one database for documents, chunks, vectors **and** full-text search
     (`tsvector`), so hybrid search is a single SQL query. Real transactions make
     "delete old chunks + insert new ones" atomic (idempotent ingestion). HNSW index support.
     Managed on AWS (RDS / Aurora PostgreSQL). We already know SQL.
   - Cons: at very large scale (hundreds of millions of vectors) dedicated engines are faster
     and easier to tune.
2. **Dedicated vector DB (Qdrant, Weaviate, Milvus, Pinecone).**
   - Pros: built for vector search, rich filtering, horizontal scale.
   - Cons: a second datastore to run and keep in sync with metadata. Keyword search and
     fusion are product-specific. Pinecone is cloud-only, so there's no offline local dev.
3. **In-process index (FAISS, hnswlib) or an embedded store (Chroma).** Great for notebooks.
   No concurrency, persistence or multi-instance story for an API that moves to AWS.

## Decision
PostgreSQL 18 with pgvector 0.8 (`pgvector/pgvector:0.8.7-pg18` image).
The extension is enabled by migration `001_enable_pgvector.sql`. Tables and the HNSW index
arrive in Milestones 5 and 6.

## Consequences
- Hybrid search (Milestone 7) = vector query + full-text query + RRF, all in Postgres.
- Our corpus (internal docs, thousands to low millions of chunks) is far below where pgvector struggles.
- Embedding dimension is fixed per column (`vector(1536)` for text-embedding-3-small).
  Changing the embedding model means a migration plus re-embedding everything.
