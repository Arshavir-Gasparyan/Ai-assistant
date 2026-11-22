import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * End-to-end over REAL stdio: starts the BUILT server (dist/index.js) as a child process,
 * exactly like Claude Desktop does, against a tiny stub of the backend API.
 * If anything wrote to stdout besides the protocol, the handshake below would fail.
 */
const ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));

describe('stdio transport (built server as a child process)', () => {
  let api: Server;
  let client: Client;

  beforeAll(async () => {
    api = createHttpServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const { question } = JSON.parse(body) as { question: string };
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            answer: `Stub answer to: ${question} [1]`,
            answerable: true,
            refusalReason: null,
            citations: [{ n: 1, chunkId: 'c', documentId: 'd', filename: 'stub.md', heading: 'Stub', pageNumber: null, snippet: 's' }],
            model: 'stub',
            promptVersion: 'rag-answer@v1',
            warnings: [],
            conversationId: '3489b6d5-08ad-4c92-916d-94a30b8383ac',
            standaloneQuestion: question,
          }),
        );
      });
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    const { port } = api.address() as AddressInfo;

    client = new Client({ name: 'stdio-test', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [ENTRY],
        env: { KNOWLEDGE_API_URL: `http://127.0.0.1:${port}`, PATH: process.env.PATH ?? '' },
        stderr: 'ignore',
      }),
    );
  });

  afterAll(async () => {
    await client?.close();
    await new Promise((resolve) => api?.close(resolve));
  });

  it('completes the MCP handshake and identifies itself', () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'ai-knowledge-assistant' });
  });

  it('calls ask_question through the child process and the HTTP API', async () => {
    const result = await client.callTool({ name: 'ask_question', arguments: { question: 'Ping?' } });
    expect((result.content as { text: string }[])[0]!.text).toContain('Stub answer to: Ping? [1]');
  });
});
