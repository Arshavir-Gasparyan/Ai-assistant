# ADR-0006: Embedding model, OpenAI text-embedding-3-small

- **Status:** Accepted
- **Date:** 2026-11-21
- **Scope:** embeddings only. The chat model choice gets its own ADR in Milestone 8.

## Context
Every chunk and every question is turned into a vector, and retrieval quality depends on how
well that vector captures meaning. The model also fixes the vector dimension, which is part of the
database column type (`vector(1536)`). Switching models later means re-embedding every chunk.
The task specifies an OpenAI-compatible API, with a local Ollama model as a comparison.

## Options considered
| Model | Dims | Price / 1M tokens | Notes |
|---|---|---|---|
| **OpenAI text-embedding-3-small** | 1536 | $0.02 | Strong quality/price, widely used, max 8,191 input tokens |
| OpenAI text-embedding-3-large | 3072 | $0.13 | Better on hard retrieval benchmarks, 6.5× the price, 2× the storage. pgvector's HNSW indexes vectors only up to 2,000 dims (halfvec up to 4,000), so it needs `halfvec` or reduced `dimensions` |
| Local via Ollama (e.g. nomic-embed-text) | 768 | free | Offline and private. Needs a different column size and runs on your CPU/GPU |
| Cohere / Voyage / Bedrock Titan | varies | varies | Good options, but another vendor and SDK |

Prices are from the provider's model page (checked 2026-11-21).

## Decision
`text-embedding-3-small`, 1536 dimensions, cosine distance, behind an `Embedder` interface
(`src/embeddings/`). Implementations:
- `openai`: the real one, using the official SDK (retries and timeouts built in), batches of 100.
- `fake`: deterministic word-hashing vectors for tests and for offline demos. Not semantic.
- A 503 stub when no key is configured, so the API still boots.

We embed `heading path + content` (a contextual chunk header), not the content alone.
Each document records `embedding_model`, and re-uploading with a different model re-embeds it.

## Consequences
- Cost is negligible for our scale: the three sample documents are ~2k tokens ≈ $0.00004.
  Each question costs ~10–20 tokens.
- Document text is sent to OpenAI. That's acceptable for this project's sample data. Real
  confidential documents would need a data processing agreement, Azure OpenAI or Bedrock,
  or a local model.
- Changing model or dimension = new migration (column type) + re-embedding all documents.
  The `embedding_model` column makes that detectable.
- An Ollama embedder can be added behind the same interface. Because of the different
  dimension it needs its own column or table, so it's left for the Ollama comparison work.
