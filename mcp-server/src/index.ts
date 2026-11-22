#!/usr/bin/env node
/**
 * Entry point. An MCP client (Claude Desktop, Claude Code, the MCP Inspector) starts this
 * process and talks to it over stdin/stdout using JSON-RPC.
 *
 *   ⚠  stdout belongs to the protocol. A single console.log() here would corrupt the
 *      stream and break the connection. Diagnostics go to stderr (console.error), which
 *      clients show in their MCP logs.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createKnowledgeApi } from './api-client.js';
import { createServer } from './server.js';

const apiUrl = process.env.KNOWLEDGE_API_URL ?? 'http://localhost:4000';
const timeoutMs = Number(process.env.KNOWLEDGE_API_TIMEOUT_MS ?? 60_000);

const server = createServer(createKnowledgeApi(apiUrl, { timeoutMs }));
await server.connect(new StdioServerTransport());

console.error(`[knowledge-mcp] ready on stdio, using API ${apiUrl}`);

// The client closes stdin when it shuts us down.
process.stdin.on('close', () => {
  void server.close().finally(() => process.exit(0));
});
