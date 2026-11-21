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
| Same filename, identical content | 200 | `unchanged` (nothing rewritten) |

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
