# Tool Directory MCP Server

MCP server for the [AI Tool Directory](https://tooldirectory.ai) — a live, human-edited catalog of 2,000+ AI tools. Lets any MCP client (Claude Desktop, Claude Code, Cursor, Windsurf, agent frameworks) query the catalog mid-task instead of guessing from a frozen training cut.

The headline tool is **`check_tool_status`**: whether an AI tool is still alive. It's the one fact LLMs reliably get wrong — models keep recommending products that shut down months ago. This server answers it from the directory's [AI Graveyard](https://tooldirectory.ai/graveyard), a maintained dataset of 150+ defunct and acquired AI tools, and suggests live alternatives when a tool is dead.

## Tools

| Tool | What it does |
| --- | --- |
| `search_tools` | Hybrid semantic search across the catalog — by keyword, use case, or category. |
| `get_tool` | Full profile of one tool: pricing, features, editorial verdict, last human-verified date. |
| `check_tool_status` | Is this tool active, deceased, or acquired? Date + cause if it shut down, plus live alternatives. |
| `find_alternatives` | Curated alternatives to a tool; live replacements if it's defunct. |
| `compare_tools` | Side-by-side comparison of two tools, with the editor's head-to-head verdict when one exists. |
| `list_tools` | Top-rated active tools for a category or job role, optionally filtered by pricing. |

Read-only, no API key, no signup.

## Install

### Hosted endpoint (no install)

The server is also available as a remote MCP (Streamable HTTP) — point your client at:

```
https://tooldirectory.ai/api/mcp
```

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "tooldirectory": {
      "command": "npx",
      "args": ["-y", "tooldirectory-mcp"]
    }
  }
}
```

Or with Claude Code:

```bash
claude mcp add tooldirectory -- npx -y tooldirectory-mcp
```

### Cursor / Windsurf / other MCP clients

Use the same stdio command: `npx -y tooldirectory-mcp`.

### Docker

```bash
docker build -t tooldirectory-mcp .
docker run -i tooldirectory-mcp
```

## Example prompts

- *"Is Jasper still operating? What happened to Inflection Pi?"*
- *"Find me alternatives to Midjourney with a free tier."*
- *"Compare Gamma and Beautiful.ai for making decks."*
- *"What are the best AI tools for sales teams?"*

## How it works

This package is a thin stdio front-end over the canonical hosted endpoint at `tooldirectory.ai/api/mcp`, where the search (Meilisearch hybrid semantic) and catalog logic live. Tool schemas are declared locally, so `initialize` and `tools/list` respond instantly with no network call; `tools/call` proxies to the hosted endpoint. Zero runtime dependencies.

Set `TOOLDIRECTORY_MCP_ENDPOINT` to override the upstream endpoint (e.g. for testing).

## About the data

The catalog is maintained by [Tool Directory](https://tooldirectory.ai) — an AI tool company run by humans that use AI. Every listed tool has a lifecycle status; editorial reviews carry a named editor and a last-verified date. Related machine-readable surfaces:

- [Research hub](https://tooldirectory.ai/research) — AI tool mortality statistics
- [Catalog feed](https://tooldirectory.ai/feed/catalog.json) / [Graveyard feed](https://tooldirectory.ai/feed/graveyard.json)
- [/mcp](https://tooldirectory.ai/mcp) — server documentation page

## License

MIT
