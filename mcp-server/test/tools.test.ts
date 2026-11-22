import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeApiError, type ChatResponse, type KnowledgeApi, type SearchResponse } from '../src/api-client.js';
import { createServer } from '../src/server.js';

/**
 * Calls the tools through the real MCP protocol (JSON-RPC messages, schema validation),
 * just over an in-memory pipe instead of stdin/stdout. The backend API is faked.
 */
const SEARCH: SearchResponse = {
  query: 'carry over',
  modeUsed: 'hybrid',
  warnings: [],
  results: [
    {
      chunkId: 'c1',
      documentId: 'd1',
      filename: 'employee-handbook.md',
      heading: 'Leave > Vacation > Carry-over',
      pageNumber: null,
      content: 'Up to 5 unused vacation days can be carried over.',
      score: 0.0328,
      ranks: { vector: 1, keyword: 1 },
      similarity: 0.61,
    },
    {
      chunkId: 'c2',
      documentId: 'd2',
      filename: 'expense-policy.pdf',
      heading: null,
      pageNumber: 2,
      content: 'x'.repeat(2000),
      score: 0.016,
      ranks: { vector: null, keyword: 2 },
      similarity: null,
    },
  ],
};

const ANSWER: ChatResponse = {
  answer: 'You can carry over up to 5 days [1].',
  answerable: true,
  refusalReason: null,
  citations: [
    { n: 1, chunkId: 'c1', documentId: 'd1', filename: 'employee-handbook.md', heading: 'Leave > Carry-over', pageNumber: null, snippet: 'Up to 5…' },
  ],
  model: 'gpt-4.1-mini',
  promptVersion: 'rag-answer@v1',
  warnings: [],
  conversationId: '3489b6d5-08ad-4c92-916d-94a30b8383ac',
  standaloneQuestion: 'How many vacation days can I carry over?',
};

describe('MCP tools (in-memory protocol)', () => {
  let client: Client;
  let api: { [K in 'search' | 'ask']: ReturnType<typeof vi.fn> } & { baseUrl: string };

  beforeEach(async () => {
    api = { baseUrl: 'http://fake', search: vi.fn(async () => SEARCH), ask: vi.fn(async () => ANSWER) };
    const server = createServer(api as unknown as KnowledgeApi);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
  });

  const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
    (result.content as { type: string; text: string }[])[0]!.text;

  it('advertises the two tools with JSON schemas and read-only annotations', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['ask_question', 'search_documents']);

    const search = tools.find((t) => t.name === 'search_documents')!;
    expect(search.inputSchema.required).toEqual(['query']);
    expect(search.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(search.outputSchema).toBeDefined();
    expect(search.description).toMatch(/not instructions/);
  });

  it('sends instructions to the client when it connects', () => {
    expect(client.getInstructions()).toMatch(/ask_question/);
  });

  it('search_documents: numbered passages with sources, plus structured content', async () => {
    const result = await client.callTool({ name: 'search_documents', arguments: { query: 'carry over', topK: 2 } });

    expect(api.search).toHaveBeenCalledWith({ query: 'carry over', topK: 2 });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('Found 2 passages for "carry over" (hybrid search).');
    expect(text(result)).toContain('[1] employee-handbook.md › Leave > Vacation > Carry-over\nUp to 5 unused');
    expect(text(result)).toContain('[2] expense-policy.pdf › page 2');
    expect(result.structuredContent).toMatchObject({ modeUsed: 'hybrid', results: [{ n: 1 }, { n: 2 }] });
    // Long passages are truncated to protect the client's context window.
    const passage2 = (result.structuredContent as { results: { content: string }[] }).results[1]!.content;
    expect(passage2.length).toBeLessThan(1300);
  });

  it('ask_question: answer, sources and the conversationId for follow-ups', async () => {
    const result = await client.callTool({ name: 'ask_question', arguments: { question: 'How many days can I carry over?' } });

    expect(text(result)).toBe(
      'You can carry over up to 5 days [1].\n\nSources:\n[1] employee-handbook.md › Leave > Carry-over\n\n' +
        'conversationId: 3489b6d5-08ad-4c92-916d-94a30b8383ac (pass it with follow-up questions)',
    );
    expect(result.structuredContent).toMatchObject({ answerable: true, conversationId: ANSWER.conversationId });
  });

  it('ask_question passes conversationId through for follow-ups', async () => {
    await client.callTool({ name: 'ask_question', arguments: { question: 'and sick days?', conversationId: ANSWER.conversationId } });
    expect(api.ask).toHaveBeenCalledWith({ question: 'and sick days?', conversationId: ANSWER.conversationId });
  });

  it('a refusal is a normal result (not an error), clearly marked', async () => {
    api.ask.mockResolvedValueOnce({
      ...ANSWER,
      answer: "I couldn't find the answer to that in the uploaded documents.",
      answerable: false,
      refusalReason: 'not_in_sources',
      citations: [],
    });
    const result = await client.callTool({ name: 'ask_question', arguments: { question: 'CEO salary?' } });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toMatch(/^Not found in the documents\./);
  });

  it('API failures come back as isError results the model can read', async () => {
    api.search.mockRejectedValueOnce(new KnowledgeApiError('API_UNREACHABLE', 'Cannot reach the knowledge API.'));
    const result = await client.callTool({ name: 'search_documents', arguments: { query: 'q' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('Cannot reach the knowledge API. (API_UNREACHABLE)');
  });

  it('invalid arguments are rejected before reaching the API', async () => {
    const result = await client
      .callTool({ name: 'ask_question', arguments: { question: '', conversationId: 'not-a-uuid' } })
      .catch((err: Error) => ({ isError: true, content: [{ type: 'text', text: err.message }] }));
    expect(result.isError).toBe(true);
    expect(api.ask).not.toHaveBeenCalled();
  });
});
