-- Enable the pgvector extension: adds the `vector` column type, distance operators
-- (<=> cosine, <-> L2, <#> inner product) and the HNSW / IVFFlat index types.
-- The pgvector/pgvector Docker image ships the extension binaries. This makes them
-- available in our database. Tables for documents and chunks come in Milestones 5-6.
CREATE EXTENSION IF NOT EXISTS vector;
