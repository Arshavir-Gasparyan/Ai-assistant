-- Milestone 7: keyword (full-text) search over chunks.
--
-- search_tsv is a GENERATED column: Postgres computes it from heading + content on every
-- INSERT/UPDATE, so application code can never forget to fill it in.
--
--   to_tsvector('english', 'Unused days are carried over')  →  'carri':4 'day':2 'unus':1
--
-- Words are lower-cased and stemmed ("carried" → "carri", same as "carry"), and stop words
-- ("are", "over") are dropped. Heading words get weight A, body words weight B, so a match
-- in the heading path ranks higher.
ALTER TABLE chunks ADD COLUMN search_tsv tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(heading, '')), 'A') ||
  setweight(to_tsvector('english', content), 'B')
) STORED;

-- GIN = an inverted index (word → list of rows), which makes the `@@` match operator fast.
CREATE INDEX chunks_search_tsv_idx ON chunks USING gin (search_tsv);
