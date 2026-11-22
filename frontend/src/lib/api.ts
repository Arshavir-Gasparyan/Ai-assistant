/**
 * The single place the frontend talks to the backend.
 *
 * Every page goes through apiFetch() so that the base URL, JSON handling, and the
 * backend's error format ({ error: { code, message, details } }) are handled in one
 * spot. Streaming chat uses streamChat() below, built on readSse().
 */

import { readSse } from './sse';

// Inlined at build time by Next.js because of the NEXT_PUBLIC_ prefix.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Mirrors ApiErrorBody in backend/src/plugins/error-handler.ts (see ADR-0001 on shared types). */
interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...init?.headers },
    });
  } catch {
    // Network failure, backend down, or a CORS rejection (the browser hides which one).
    throw new ApiError(0, 'NETWORK_ERROR', `Cannot reach the API at ${API_URL}`);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      res.status,
      body?.error.code ?? 'HTTP_ERROR',
      body?.error.message ?? `Request failed with status ${res.status}`,
      body?.error.details,
    );
  }

  // 204 No Content (e.g. DELETE) has no body to parse.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---- Endpoints ----

export interface HealthResponse {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

export const getHealth = (signal?: AbortSignal) => apiFetch<HealthResponse>('/health', { signal });

// Documents (backend/src/documents/routes.ts). Types are mirrored by hand (ADR-0001).

export interface DocumentSummary {
  id: string;
  filename: string;
  kind: 'pdf' | 'markdown';
  sizeBytes: number;
  contentHash: string;
  pageCount: number | null;
  chunkCount: number;
  status: 'processing' | 'ready' | 'failed';
  embeddingModel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Chunk {
  id: string;
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  heading: string | null;
  tokenEstimate: number;
}

export type UploadOutcome = 'created' | 'replaced' | 'unchanged';

export const listDocuments = (signal?: AbortSignal) =>
  apiFetch<{ documents: DocumentSummary[] }>('/documents', { signal }).then((r) => r.documents);

export const getDocument = (id: string, signal?: AbortSignal) =>
  apiFetch<DocumentSummary & { chunks: Chunk[] }>(`/documents/${id}`, { signal });

/**
 * multipart/form-data upload. Don't set Content-Type yourself: the browser adds it with
 * the boundary string that separates the parts.
 */
export function uploadDocument(file: File) {
  const body = new FormData();
  body.append('file', file);
  return apiFetch<{ outcome: UploadOutcome; document: DocumentSummary }>('/documents', { method: 'POST', body });
}

export const deleteDocument = (id: string) => apiFetch<void>(`/documents/${id}`, { method: 'DELETE' });

// Search (backend/src/search/routes.ts).

export type SearchMode = 'hybrid' | 'vector' | 'keyword';

export interface SearchResult {
  chunkId: string;
  documentId: string;
  filename: string;
  heading: string | null;
  pageNumber: number | null;
  content: string;
  score: number;
  ranks: { vector: number | null; keyword: number | null };
  similarity: number | null;
}

export interface SearchResponse {
  query: string;
  modeUsed: SearchMode;
  results: SearchResult[];
  warnings: string[];
}

export const searchChunks = (body: { query: string; mode: SearchMode; topK: number }, signal?: AbortSignal) =>
  apiFetch<SearchResponse>('/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

// Chat (backend/src/rag/routes.ts).

export interface Citation {
  n: number;
  chunkId: string;
  documentId: string;
  filename: string;
  heading: string | null;
  pageNumber: number | null;
  snippet: string;
}

export type RefusalReason = 'no_sources' | 'not_in_sources' | 'no_valid_citations';

export interface ChatMeta {
  model: string;
  promptVersion: string;
  retrieval: { modeUsed: SearchMode; sources: number };
  warnings: string[];
}

export interface ChatAnswer extends ChatMeta {
  answer: string;
  answerable: boolean;
  refusalReason: RefusalReason | null;
  citations: Citation[];
}

export interface ChatStreamHandlers {
  onMeta: (meta: ChatMeta) => void;
  /** A piece of the answer as it is generated: a preview, see onDone. */
  onDelta: (text: string) => void;
  /** The verified answer. Replaces the streamed preview (invalid citations removed). */
  onDone: (answer: ChatAnswer) => void;
}

/**
 * POST /chat/stream and dispatch its Server-Sent Events. Resolves when the stream ends.
 * Throws ApiError for HTTP errors (e.g. 400), network failures, and `error` events.
 * Abort with the signal: the backend notices the closed connection and stops the LLM call.
 */
export async function streamChat(
  body: { question: string; topK?: number },
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError(0, 'NETWORK_ERROR', `Cannot reach the API at ${API_URL}`);
  }

  // Errors before the stream started (validation) are normal JSON error responses.
  if (!res.ok || !res.body) {
    const errBody = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, errBody?.error.code ?? 'HTTP_ERROR', errBody?.error.message ?? `Request failed with status ${res.status}`);
  }

  for await (const { event, data } of readSse(res.body)) {
    const payload = JSON.parse(data);
    if (event === 'meta') handlers.onMeta(payload as ChatMeta);
    else if (event === 'delta') handlers.onDelta((payload as { text: string }).text);
    else if (event === 'done') handlers.onDone(payload as ChatAnswer);
    else if (event === 'error') {
      const { code, message } = payload as { code: string; message: string };
      throw new ApiError(200, code, message);
    }
  }
}
