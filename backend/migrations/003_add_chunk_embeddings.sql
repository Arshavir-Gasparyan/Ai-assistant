-- Each chunk gets an embedding: 1536 numbers produced by OpenAI text-embedding-3-small.
-- The dimension is part of the column TYPE. Vectors from a model with a different size
-- (e.g. 768 for nomic-embed-text) can't be stored here, and vectors from different models
-- must never be compared with each other anyway.
ALTER TABLE chunks ADD COLUMN embedding vector(1536);

-- Which model produced this document's vectors. If we switch models, a re-upload
-- notices the mismatch and re-embeds instead of answering "unchanged".
ALTER TABLE documents ADD COLUMN embedding_model text;

-- HNSW (Hierarchical Navigable Small World) index for fast approximate nearest-neighbour
-- search. Without it, every search compares the question with EVERY chunk (exact but O(n)).
-- vector_cosine_ops: the index serves ORDER BY embedding <=> $query (cosine distance).
-- Defaults: m = 16 (links per node), ef_construction = 64 (build-time search width).
CREATE INDEX chunks_embedding_hnsw_idx ON chunks USING hnsw (embedding vector_cosine_ops);
