import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { KnowledgeApi } from './api-client.js';
import { registerTools } from './tools.js';

export const SERVER_INFO = { name: 'ai-knowledge-assistant', version: '0.1.0' };

/** Builds the MCP server without a transport, so tests can connect it in-memory. */
export function createServer(api: KnowledgeApi): McpServer {
  const server = new McpServer(SERVER_INFO, {
    // Shown to the client model when it connects: when to reach for these tools.
    instructions:
      "Use these tools to answer questions about the organization's internal documents (employee handbook, " +
      'IT security policy, expense policy, and anything else uploaded). Prefer ask_question for direct questions ' +
      'and cite its sources; use search_documents to read passages. If a tool says the answer is not in the ' +
      'documents, tell the user instead of guessing.',
  });
  registerTools(server, api);
  return server;
}
