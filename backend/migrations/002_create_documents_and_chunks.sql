-- One row per uploaded file.
-- `filename` is the document's identity: uploading the same filename again REPLACES it
-- (idempotent ingestion). `content_hash` detects whether the content actually changed.
CREATE TABLE documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename     text NOT NULL UNIQUE,
  kind         text NOT NULL CHECK (kind IN ('pdf', 'markdown')),
  size_bytes   integer NOT NULL CHECK (size_bytes > 0),
  content_hash text NOT NULL,              -- sha256 of the raw file bytes (hex)
  page_count   integer,                    -- PDFs only
  chunk_count  integer NOT NULL DEFAULT 0,
  -- 'ready' while ingestion is synchronous. Milestone 6 (embeddings) may use 'processing'.
  status       text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per chunk: the unit we retrieve and cite.
-- Embedding column + HNSW index: Milestone 6. Full-text search column: Milestone 7.
CREATE TABLE chunks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE CASCADE: deleting a document deletes its chunks automatically.
  document_id    uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  chunk_index    integer NOT NULL,         -- 0, 1, 2... order within the document
  content        text NOT NULL,
  page_number    integer,                  -- PDFs: the page this chunk came from (for citations)
  heading        text,                     -- Markdown: heading path, e.g. "Leave > Vacation > Carry-over"
  token_estimate integer NOT NULL,         -- ~chars/4. Real tokenizer arrives with token budgets (M10)
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Also serves as the index for "all chunks of document X, in order".
  UNIQUE (document_id, chunk_index)
);
