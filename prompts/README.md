# Prompt templates

Prompts live in **`backend/src/prompts/`** as versioned TypeScript modules (for example
`rag-answer.ts` → `rag-answer@v1`). They live in the backend because the Docker image is
built from `backend/` only, so files here would not ship with the API (see ADR-0008).

Rules:
- Never edit a published version. Add `v2`, switch the `RAG_ANSWER` export, and compare both
  versions with the evaluation set.
- Every answer returns and logs its `promptVersion`.
