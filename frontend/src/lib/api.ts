/**
 * The single place the frontend talks to the backend.
 *
 * Every page goes through apiFetch() so that the base URL, JSON handling, and the
 * backend's error format ({ error: { code, message, details } }) are handled in one
 * spot. Streaming chat (SSE, Milestone 9) gets its own helper here later.
 */

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

  return (await res.json()) as T;
}

// ---- Endpoints ----

export interface HealthResponse {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

export const getHealth = (signal?: AbortSignal) => apiFetch<HealthResponse>('/health', { signal });
