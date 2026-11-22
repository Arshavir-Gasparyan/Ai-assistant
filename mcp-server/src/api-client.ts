/**
 * The MCP server is a thin client of the backend's HTTP API (ADR-0011): retrieval, prompts,
 * guardrails, memory and LLM logging all stay in ONE place, and this process needs no
 * secrets: only the API's URL.
 *
 * Types mirror backend/src/search/routes.ts and backend/src/rag/routes.ts (ADR-0001: no
 * shared package, so they are copied by hand and kept minimal).
 */

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

export interface Citation {
  n: number;
  chunkId: string;
  documentId: string;
  filename: string;
  heading: string | null;
  pageNumber: number | null;
  snippet: string;
}

export interface ChatResponse {
  answer: string;
  answerable: boolean;
  refusalReason: 'no_sources' | 'not_in_sources' | 'no_valid_citations' | null;
  citations: Citation[];
  model: string;
  promptVersion: string;
  warnings: string[];
  conversationId: string;
  standaloneQuestion: string;
}

export class KnowledgeApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'KnowledgeApiError';
  }
}

export interface KnowledgeApi {
  readonly baseUrl: string;
  search(body: { query: string; topK?: number; mode?: SearchMode }): Promise<SearchResponse>;
  ask(body: { question: string; conversationId?: string }): Promise<ChatResponse>;
}

export function createKnowledgeApi(
  baseUrl: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): KnowledgeApi {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const root = baseUrl.replace(/\/+$/, '');

  async function post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${root}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        // An LLM answer takes seconds. Don't let a hung API hang the MCP client forever.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if ((err as Error).name === 'TimeoutError') {
        throw new KnowledgeApiError('TIMEOUT', `The knowledge API did not respond within ${timeoutMs / 1000}s.`);
      }
      throw new KnowledgeApiError(
        'API_UNREACHABLE',
        `Cannot reach the knowledge API at ${root}. Is it running? (docker compose up -d)`,
      );
    }

    if (!res.ok) {
      const errorBody = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      throw new KnowledgeApiError(
        errorBody?.error?.code ?? `HTTP_${res.status}`,
        errorBody?.error?.message ?? `The knowledge API returned HTTP ${res.status}.`,
      );
    }
    return (await res.json()) as T;
  }

  return {
    baseUrl: root,
    search: (body) => post<SearchResponse>('/search', body),
    ask: (body) => post<ChatResponse>('/chat', body),
  };
}
