import { describe, expect, it, vi } from 'vitest';
import { createKnowledgeApi } from '../src/api-client.js';

describe('createKnowledgeApi', () => {
  it('POSTs JSON to /search and /chat on the configured URL', async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const api = createKnowledgeApi('http://api.test:4000/', { fetch });

    await api.search({ query: 'vacation', topK: 3 });
    await api.ask({ question: 'How many days?' });

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test:4000/search'); // trailing slash handled
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ query: 'vacation', topK: 3 });
    expect((fetch.mock.calls[1] as unknown as [string])[0]).toBe('http://api.test:4000/chat');
  });

  it("turns the API's error body into a KnowledgeApiError with its code", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ error: { code: 'CHAT_NOT_CONFIGURED', message: 'Chat is not configured.' } }, { status: 503 }),
    );
    await expect(createKnowledgeApi('http://x', { fetch }).ask({ question: 'q' })).rejects.toMatchObject({
      code: 'CHAT_NOT_CONFIGURED',
      message: 'Chat is not configured.',
    });
  });

  it('explains when the API is not running', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(createKnowledgeApi('http://localhost:4000', { fetch }).search({ query: 'q' })).rejects.toMatchObject({
      code: 'API_UNREACHABLE',
      message: expect.stringContaining('docker compose up'),
    });
  });

  it('gives up after the timeout', async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    await expect(createKnowledgeApi('http://x', { fetch, timeoutMs: 20 }).ask({ question: 'q' })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });
});
