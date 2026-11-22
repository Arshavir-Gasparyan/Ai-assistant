# ADR-0007: Hybrid search, pgvector + Postgres full-text, fused with RRF

- **Status:** Accepted
- **Date:** 2026-11-22

## Context
Retrieval decides what the LLM gets to read in Milestone 8, so a chunk that isn't retrieved
can't be cited. The two classic retrieval methods fail in opposite ways (examples from our documents):

| Question | Vector search | Keyword search |
|---|---|---|
| "How much paid time off is there?" | ✅ finds "25 days of paid vacation" (same meaning) | ⚠️ only via the word "paid" |
| "Minimum 14 characters?" / product codes / names | ⚠️ embeddings blur exact tokens | ✅ exact match |

## Options considered
| Option | Pros | Cons |
|---|---|---|
| Vector only | Simple, semantic | Misses exact terms, IDs, rare words |
| Keyword only (FTS / BM25) | Exact, explainable, no API cost | No synonyms or paraphrases |
| **Hybrid, Reciprocal Rank Fusion** | Gets both. Rank-based, so no score normalisation and nothing to tune | Two queries per search |
| Hybrid, weighted score sum (`α·cos + (1-α)·rank`) | Tunable | Scores are on different scales and need normalising. α must be tuned with an eval set |
| Hybrid + cross-encoder reranker (Cohere, bge-reranker) | Best quality | Another model, latency and cost. Can be layered on later |
| Separate search engine (Elasticsearch/OpenSearch) | Real BM25, scale | Another service to run. Postgres covers our size (ADR-0003) |

## Decision
- **Keyword:** Postgres full-text search on a generated `search_tsv` column (heading = weight A,
  content = weight B, `english` config: stemming + stop words), GIN index, ranked with `ts_rank_cd`.
- **Query parsing:** OR of the stemmed query words (`plainto_tsquery` with `&` replaced by `|`).
  The first version used `websearch_to_tsquery`, which ANDs every word. It returned **nothing** for
  natural questions like "How many vacation days can I carry over?", because "many" is in no chunk.
- **Vector:** cosine distance with the HNSW index, restricted to chunks embedded by the current model.
- **Fusion:** RRF with k = 60, over max(4·topK, 20) candidates from each search (capped at 50).
- **Degradation:** in `hybrid` mode, if the embedding provider is unavailable, return keyword
  results with a warning instead of failing.

## Consequences
- Search works without an OpenAI key (keyword-only), which helps local development and outages.
- The RRF `score` is not a confidence measure. In Milestone 8, the "refuse when the context lacks the
  answer" decision must use something else (e.g. `similarity` or the LLM's own judgement).
- `ts_rank_cd` is not true BM25 (no IDF across the corpus). That's fine at our scale. A
  `pg_search`/ParadeDB BM25 index or a reranker are possible upgrades, measured with the eval set.
- English-only stemming. Documents in other languages would need another text search config.
- At larger scale, a filtered HNSW query (`WHERE embedding_model = …`) can return fewer than
  LIMIT rows. pgvector 0.8's `hnsw.iterative_scan` fixes that if it becomes an issue.
