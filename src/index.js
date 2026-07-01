#!/usr/bin/env node
/**
 * tooldirectory-mcp — stdio MCP server for the AI Tool Directory catalog
 * (https://tooldirectory.ai).
 *
 * Lets any MCP client (Claude Desktop, Cursor, Windsurf, agent frameworks)
 * query a live catalog of 2,000+ AI tools mid-task instead of guessing from a
 * frozen training cut. The headline capability is `check_tool_status` —
 * whether a tool is still alive — the one fact LLMs reliably get wrong and
 * the AI Graveyard dataset uniquely answers.
 *
 * Design: thin stdio front-end over the canonical hosted MCP endpoint at
 * https://tooldirectory.ai/api/mcp. Tool schemas are declared locally so
 * `initialize` and `tools/list` answer instantly with no network; `tools/call`
 * proxies to the hosted endpoint where the real search/catalog logic lives.
 * Zero runtime dependencies — the stdio protocol surface is small (newline-
 * delimited JSON-RPC 2.0) and Node 18+ ships fetch.
 *
 * Prefer a remote server? Point your client straight at
 * https://tooldirectory.ai/api/mcp (Streamable HTTP) and skip this package.
 */

const ENDPOINT = process.env.TOOLDIRECTORY_MCP_ENDPOINT || 'https://tooldirectory.ai/api/mcp';
const PROTOCOL_VERSION = '2025-06-18';
const SERVER_NAME = 'tooldirectory-ai';
const SERVER_VERSION = '1.0.0';
const CALL_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Tool definitions — kept in lockstep with the hosted endpoint's tools/list.
// Declared locally so introspection works offline and instantly.
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'search_tools',
    description:
      'Search the AI Tool Directory catalog (2,000+ AI tools) by keyword, use case, or category using hybrid semantic search. Returns ranked tools with slug, one-line description, pricing model, and rating. Use this to discover tools, then get_tool for full detail.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What the user is looking for, e.g. "AI video editing" or "alternatives to Jasper".'
        },
        limit: {
          type: 'integer',
          description: 'Max results (1-20, default 8).'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_tool',
    description:
      'Get the full profile of one AI tool by its directory slug: description, pricing, key features, editorial verdict and rating, the date it was last human-verified, lifecycle status, and the official site URL.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description:
            'The directory slug, e.g. "gamma-app-ai-powered-presenting-ideas" (from search_tools).'
        }
      },
      required: ['slug']
    }
  },
  {
    name: 'check_tool_status',
    description:
      'Check whether an AI tool is still alive. Returns active, deceased, or acquired — with the date and cause if it shut down, and live alternatives if it did. Use this before recommending a tool to avoid suggesting one that no longer exists.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: {
          type: 'string',
          description:
            'Tool name or directory slug to check, e.g. "Jasper" or "jasper-ai".'
        }
      },
      required: ['tool']
    }
  },
  {
    name: 'find_alternatives',
    description:
      'Find curated alternatives to a given AI tool by its directory slug. If the tool has shut down, returns live replacements. Good for "what should I use instead of X" questions.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'The directory slug of the tool to find alternatives for.'
        }
      },
      required: ['slug']
    }
  },
  {
    name: 'compare_tools',
    description:
      'Compare two AI tools side by side by their directory slugs. Returns each tool’s profile (pricing, rating, editorial verdict, lifecycle) plus the editor’s head-to-head verdict and bottom line when one exists for the pair.',
    inputSchema: {
      type: 'object',
      properties: {
        slugA: {
          type: 'string',
          description: 'Directory slug of the first tool.'
        },
        slugB: {
          type: 'string',
          description: 'Directory slug of the second tool.'
        }
      },
      required: ['slugA', 'slugB']
    }
  },
  {
    name: 'list_tools',
    description:
      'List the top-rated active AI tools in a category or for a job role, optionally filtered by pricing. Good for "what are the best AI tools for sales" or "free tools in <category>".',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description:
            'Category slug (from search_tools results), e.g. "productivity".'
        },
        role: {
          type: 'string',
          description: 'Job-role slug, e.g. "sales", "marketing", "customer-support".'
        },
        pricing: {
          type: 'string',
          description: 'Optional pricing filter: Free, Freemium, Free Trial, or Paid.'
        },
        limit: {
          type: 'integer',
          description: 'Max results (1-20, default 8).'
        }
      }
    }
  }
];

// ---------------------------------------------------------------------------
// Upstream proxy — tools/call is forwarded to the hosted endpoint.
// ---------------------------------------------------------------------------

async function proxyToolCall(id, params) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS)
    });
    if (!res.ok) {
      return rpcResult(id, {
        content: [{ type: 'text', text: `Upstream error: HTTP ${res.status} from ${ENDPOINT}` }],
        isError: true
      });
    }
    const json = await res.json();
    if (json && typeof json === 'object' && 'result' in json) {
      return rpcResult(id, json.result);
    }
    if (json && typeof json === 'object' && 'error' in json) {
      return { jsonrpc: '2.0', id, error: json.error };
    }
    return rpcResult(id, {
      content: [{ type: 'text', text: 'Upstream returned an unexpected response shape.' }],
      isError: true
    });
  } catch (err) {
    const message = err && err.name === 'TimeoutError' ? 'Upstream request timed out.' : `Upstream request failed: ${err?.message ?? 'unknown error'}`;
    return rpcResult(id, {
      content: [{ type: 'text', text: message }],
      isError: true
    });
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 over stdio (newline-delimited)
// ---------------------------------------------------------------------------

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return rpcError(null, -32600, 'Invalid Request');
  const id = msg.id ?? null;
  const method = msg.method;

  // Notifications: no response.
  if (typeof method === 'string' && method.startsWith('notifications/')) return null;

  switch (method) {
    case 'initialize': {
      const requested = msg.params?.protocolVersion;
      return rpcResult(id, {
        protocolVersion: typeof requested === 'string' ? requested : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          'Read-only access to the AI Tool Directory catalog. Use check_tool_status before recommending a tool to confirm it still exists.'
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });
    case 'tools/call': {
      const params = msg.params ?? {};
      const known = TOOLS.some((t) => t.name === params.name);
      if (!known) {
        return rpcResult(id, {
          content: [{ type: 'text', text: `Unknown tool: ${String(params.name)}` }],
          isError: true
        });
      }
      return proxyToolCall(id, params);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${String(method)}`);
  }
}

function send(response) {
  if (response) process.stdout.write(JSON.stringify(response) + '\n');
}

// Exit only after stdin has closed AND all in-flight requests have answered —
// otherwise a one-shot pipe (or a clean client shutdown) kills pending
// tools/call fetches before their responses flush.
let pending = 0;
let stdinClosed = false;

function maybeExit() {
  if (stdinClosed && pending === 0) process.exit(0);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send(rpcError(null, -32700, 'Parse error'));
      continue;
    }
    pending += 1;
    handleMessage(msg)
      .then(send)
      .catch((err) => {
        process.stderr.write(`[tooldirectory-mcp] handler error: ${err?.message}\n`);
        send(rpcError(msg?.id ?? null, -32603, 'Internal error'));
      })
      .finally(() => {
        pending -= 1;
        maybeExit();
      });
  }
});
process.stdin.on('end', () => {
  stdinClosed = true;
  maybeExit();
});

process.stderr.write(`[tooldirectory-mcp] v${SERVER_VERSION} ready (stdio) → ${ENDPOINT}\n`);
