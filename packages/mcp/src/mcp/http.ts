#!/usr/bin/env node
/**
 * MCP Server — HTTP transport (for Railway / remote hosting).
 *
 * Exposes the same 25 tools as the stdio entry, but over Streamable HTTP
 * at POST /mcp. Clients that speak remote MCP natively (Claude.ai, Claude
 * Code with --mcp, newer Cursor) connect directly. Claude Desktop / older
 * clients use `mcp-remote` as a local stdio→HTTP bridge.
 *
 * Auth: a bearer token on every request, matched against MCP_BEARER_TOKEN.
 *   Authorization: Bearer <token>
 *
 * Env:
 *   PORT               — defaults to 3000 (Railway sets this)
 *   MCP_BEARER_TOKEN   — required; rotate to revoke access
 *   RITKEY_API_URL     — the @ritkey/service this MCP forwards tool calls to
 *   RITKEY_API_KEY     — the service's API key (server-side only — never sent to clients)
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp-server.js';

const PORT = Number(process.env.PORT ?? 3000);
const BEARER = (process.env.MCP_BEARER_TOKEN ?? '').trim();
const API_URL = process.env.RITKEY_API_URL ?? 'http://localhost:3000';

if (!BEARER) {
  console.error('MCP_BEARER_TOKEN is required');
  process.exit(1);
}

// One MCP server instance, one transport (stateful). For multi-tenant
// hosting you'd want a per-session map, but for a single-key service this is fine.
const server = createMcpServer();
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});
await server.connect(transport);

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      if (!buf) return resolve(undefined);
      try {
        resolve(JSON.parse(buf));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const httpServer = http.createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];

  if (url === '/health') {
    return json(res, 200, { status: 'ok', target: API_URL });
  }

  if (url !== '/mcp') {
    return json(res, 404, { error: 'not_found' });
  }

  // Auth gate. The MCP spec allows OAuth, but a static bearer is simpler
  // and matches how the underlying @ritkey/service is gated.
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token !== BEARER) {
    return json(res, 401, { error: 'unauthorized' });
  }

  try {
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error('[mcp-http] request failed', err);
    if (!res.headersSent) {
      json(res, 500, { error: 'internal_error' });
    }
  }
});

httpServer.listen(PORT, () => {
  console.log(`[ritual-agent-wallet] MCP HTTP server listening on :${PORT}`);
  console.log(`[ritual-agent-wallet] Forwarding tool calls to ${API_URL}`);
});
