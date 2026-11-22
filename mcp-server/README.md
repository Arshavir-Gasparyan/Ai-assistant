# Knowledge Assistant MCP server

Exposes the knowledge base to MCP clients (Claude Desktop, Claude Code, Cursor, the MCP Inspector)
as two tools, over **stdio**:

| Tool | Input | Returns |
|---|---|---|
| `search_documents` | `query`, `topK?` (1–20), `mode?` (`hybrid`/`vector`/`keyword`) | Ranked passages with file and section |
| `ask_question` | `question`, `conversationId?` | A cited answer, or "not found in the documents"; a `conversationId` for follow-ups |

It is a thin client of the backend HTTP API (`POST /search`, `POST /chat`), so it needs **no
secrets**, only `KNOWLEDGE_API_URL`. See [ADR-0011](../docs/adr/0011-mcp-server.md).

## Build

```bash
cd mcp-server
npm install
npm run build        # → dist/index.js
npm test             # builds, then unit + protocol + real-stdio tests
```

The API must be running for real use: `docker compose up -d` from the repo root.

## Try it in the MCP Inspector (a web UI for MCP servers)

```bash
npm run inspect      # opens the Inspector; click Connect → Tools → List Tools
```

## Use it from Claude Code

```bash
claude mcp add knowledge-assistant \
  -e KNOWLEDGE_API_URL=http://localhost:4000 \
  -- node /ABSOLUTE/PATH/TO/ai-knowledge-assistant/mcp-server/dist/index.js
```

Then in Claude Code: `/mcp` shows the server. Ask "Using the knowledge assistant, how many vacation days can I carry over?"

## Use it from Claude Desktop

Settings → Developer → Edit Config, then add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "knowledge-assistant": {
      "command": "/ABSOLUTE/PATH/TO/node",
      "args": ["/ABSOLUTE/PATH/TO/ai-knowledge-assistant/mcp-server/dist/index.js"],
      "env": { "KNOWLEDGE_API_URL": "http://localhost:4000" }
    }
  }
}
```

Restart Claude Desktop. Use an **absolute path to `node`** (run `which node`): Desktop doesn't load
your shell profile, so `nvm` versions may not be on its PATH. Node 20+ works.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `KNOWLEDGE_API_URL` | `http://localhost:4000` | Where the backend API runs |
| `KNOWLEDGE_API_TIMEOUT_MS` | `60000` | Give up on a request after this long |

## Rules for changing this code

- **Never write to stdout** (`console.log`). It is the protocol channel. Use `console.error`.
- Tool failures return `isError: true` results (the model can read them), not exceptions.
- Returned passages are untrusted document text. Tool descriptions tell the client model not to follow
  instructions inside them.
