# API reference

Base URL (local): `http://localhost:4000`

All errors use one shape:

```json
{ "error": { "code": "UNSUPPORTED_FILE_TYPE", "message": "Only PDF (.pdf) and Markdown (.md) files are supported" } }
```

## Health

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness: the process is up. Always 200 if it can answer. |
| GET | `/ready` | Readiness: 200 if Postgres and Redis respond, otherwise 503 with `checks` per dependency. |

## Documents

### `POST /documents`: upload and ingest a document

`multipart/form-data` with one field, `file`. Accepted: `.pdf` (text-based) and `.md`/`.markdown`, up to `MAX_UPLOAD_BYTES` (10 MB by default).

```bash
curl -F "file=@documents/employee-handbook.md" localhost:4000/documents
```

Re-uploading the same **filename** is idempotent:

| Situation | Status | `outcome` |
|---|---|---|
| New filename | 201 | `created` |
| Same filename, different content | 200 | `replaced` (old chunks deleted, same document id) |
| Same filename, identical content, same embedding model | 200 | `unchanged` (nothing rewritten) |
| Same filename, identical content, **different** embedding model | 200 | `replaced` (re-embedded) |

```json
{
  "outcome": "created",
  "document": {
    "id": "102378e3-8e72-464d-b453-0e795175356c",
    "filename": "employee-handbook.md",
    "kind": "markdown",
    "sizeBytes": 3003,
    "contentHash": "9f2c…",
    "pageCount": null,
    "chunkCount": 10,
    "status": "ready",
    "embeddingModel": "text-embedding-3-small",
    "createdAt": "2026-11-21T14:15:33.170Z",
    "updatedAt": "2026-11-21T14:15:33.170Z"
  }
}
```

| Error | Status | `code` |
|---|---|---|
| Not multipart | 415 | `MULTIPART_REQUIRED` |
| No `file` field | 400 | `FILE_REQUIRED` |
| Empty file | 400 | `EMPTY_FILE` |
| Too large | 413 | `FST_REQ_FILE_TOO_LARGE` |
| Not PDF/Markdown (checked by content, not just extension) | 415 | `UNSUPPORTED_FILE_TYPE` |
| Corrupt/encrypted PDF | 422 | `PDF_UNREADABLE` |
| PDF without text (scanned) | 422 | `NO_EXTRACTABLE_TEXT` |
| Embedding provider failed (after retries) | 502 | `EMBEDDING_FAILED` |
| No `OPENAI_API_KEY` configured | 503 | `EMBEDDINGS_NOT_CONFIGURED` |

### `GET /documents`: list documents

Returns `{ "documents": [Document, …] }`, most recently updated first.

### `GET /documents/:id`: one document with its chunks

Returns the document fields plus `chunks`:

```json
{
  "id": "…", "filename": "employee-handbook.md", "…": "…",
  "chunks": [
    {
      "id": "…",
      "chunkIndex": 5,
      "content": "Up to 5 unused vacation days can be carried over…",
      "pageNumber": null,
      "heading": "Acme Robotics Employee Handbook > Leave > Vacation > Carry-over",
      "tokenEstimate": 51
    }
  ]
}
```

400 if `id` is not a UUID, 404 if it doesn't exist.

### `DELETE /documents/:id`

204 on success (chunks are deleted with it), 404 if not found.

## Search

### `POST /search`: hybrid search over chunks

```bash
curl -s localhost:4000/search -H 'content-type: application/json' \
  -d '{"query":"How many vacation days can I carry over?","topK":3}'
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `query` | string | (required) | 1–500 characters after trimming |
| `topK` | integer | 5 | 1–20 |
| `mode` | `hybrid` \| `vector` \| `keyword` | `hybrid` | `vector`/`keyword` are mainly for comparing and debugging |

```json
{
  "query": "How many vacation days can I carry over?",
  "modeUsed": "hybrid",
  "warnings": [],
  "results": [
    {
      "chunkId": "…",
      "documentId": "…",
      "filename": "employee-handbook.md",
      "heading": "Acme Robotics Employee Handbook > Leave > Vacation > Carry-over",
      "pageNumber": null,
      "content": "Up to 5 unused vacation days can be carried over…",
      "score": 0.0328,
      "ranks": { "vector": 1, "keyword": 1 },
      "similarity": 0.61
    }
  ]
}
```

- `score` is the RRF score, `Σ 1/(60 + rank)`. Use it for ordering only; it is not a confidence.
- `ranks` shows where each search placed the chunk (`null` = not found by that search).
- `similarity` is cosine similarity from vector search (`null` if only keyword search found it).
- If embeddings are unavailable (no key, provider down), `hybrid` falls back to keyword search:
  `modeUsed` is `"keyword"` and `warnings` explains why. `mode: "vector"` returns 502/503 instead.
- Vector search only compares chunks embedded with the current model.
- The query text is never logged.

| Error | Status | `code` |
|---|---|---|
| Invalid body | 400 | `VALIDATION_ERROR` |
| `mode: "vector"`, provider failed | 502 | `EMBEDDING_FAILED` |
| `mode: "vector"`, no key | 503 | `EMBEDDINGS_NOT_CONFIGURED` |

## Chat

### `POST /chat`: answer a question from the documents, with citations

```bash
curl -s localhost:4000/chat -H 'content-type: application/json' \
  -d '{"question":"How many vacation days can I carry over?"}'
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `question` | string | (required) | 1–1000 characters after trimming |
| `topK` | integer | 5 | Chunks given to the model, 1–10 |

```json
{
  "answer": "You can carry over up to 5 unused vacation days into the next year [1].",
  "answerable": true,
  "refusalReason": null,
  "citations": [
    {
      "n": 1,
      "chunkId": "…",
      "documentId": "…",
      "filename": "employee-handbook.md",
      "heading": "Acme Robotics Employee Handbook > Leave > Vacation > Carry-over",
      "pageNumber": null,
      "snippet": "Up to 5 unused vacation days can be carried over…"
    }
  ],
  "model": "gpt-4.1-mini",
  "promptVersion": "rag-answer@v1",
  "retrieval": { "modeUsed": "hybrid", "sources": 5 },
  "warnings": []
}
```

- `[n]` markers in `answer` match `citations[].n`. Markers pointing to non-existent sources are removed.
- **Refusal:** `answerable: false`, a fixed `answer` ("I couldn't find the answer to that in the uploaded
  documents."), no citations, and a `refusalReason`:
  - `no_sources`: search found nothing (the LLM is not called)
  - `not_in_sources`: the model said the sources don't contain the answer
  - `no_valid_citations`: the model answered but cited no real source
- Neither the question nor the answer is logged. Only the outcome, token counts and cost are.

| Error | Status | `code` |
|---|---|---|
| Invalid body | 400 | `VALIDATION_ERROR` |
| LLM provider failed (after retries) | 502 | `CHAT_FAILED` |
| LLM reply cut off, refused by the provider, or not matching the schema | 502 | `CHAT_INVALID_RESPONSE` |
| No `OPENAI_API_KEY` | 503 | `CHAT_NOT_CONFIGURED` |

### `POST /chat/stream`: the same answer, streamed as Server-Sent Events

Same request body as `POST /chat`. The response is `text/event-stream`:

```
event: meta
data: {"model":"gpt-4.1-mini","promptVersion":"rag-answer@v1","retrieval":{"modeUsed":"hybrid","sources":5},"warnings":[]}

event: delta
data: {"text":"You can carry over up to 5"}

event: delta
data: {"text":" unused vacation days [1]."}

event: done
data: { …exactly the POST /chat response body… }
```

| Event | When | Data |
|---|---|---|
| `meta` | Once, after retrieval | model, promptVersion, retrieval, warnings |
| `delta` | Many times while the model writes | `{ text }`, the next piece of the answer |
| `done` | Once, at the end | The full `POST /chat` body. **Authoritative**: replace the streamed text with `done.answer` (invalid citations removed, grounding checked) |
| `error` | Instead of `done` | `{ code, message }`, e.g. `CHAT_FAILED`, `CHAT_NOT_CONFIGURED` |

- Refusals send `meta` then `done` (no `delta`).
- Validation errors are normal `400` JSON responses (sent before the stream starts).
- Lines starting with `:` are heartbeats (every 15 s). Ignore them.
- Closing the connection cancels generation on the server.
- Browsers: use `fetch` and read `response.body` (`EventSource` can't POST). See `frontend/src/lib/sse.ts`.

```bash
curl -N localhost:4000/chat/stream -H 'content-type: application/json' \
  -d '{"question":"How many vacation days can I carry over?"}'
```
