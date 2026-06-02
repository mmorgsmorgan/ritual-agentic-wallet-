#!/usr/bin/env node
/**
 * MCP Server — HTTP transport (for Railway / remote hosting).
 *
 * Two auth modes per bearer:
 *
 *   1. **Claimed bearer** (per-visitor identity):
 *      Issued by POST /claim. Maps to a unique wallet-service user (P-256
 *      keypair) provisioned via the admin. Each tool call signs requests
 *      with that user's keys → wallet-service treats them as distinct →
 *      each visitor gets their own wallet.
 *
 *   2. **Legacy admin bearer** (MCP_BEARER_TOKEN):
 *      Backward-compat. Uses the global RITKEY_API_KEY from env to forward
 *      requests via simple bearer auth. Shared identity. Useful for ops.
 *
 * The MCP spec session lifecycle still applies — each connected client gets
 * its own Server + Transport, keyed by mcp-session-id.
 *
 * Env:
 *   PORT                — Railway sets this; default 3000
 *   MCP_BEARER_TOKEN    — legacy admin bearer (optional if claim mode is on)
 *   RITKEY_API_URL      — wallet-service base URL (required)
 *   RITKEY_API_KEY      — wallet-service bearer (for legacy mode)
 *   ADMIN_PUBLIC_KEY    — admin P-256 pubkey hex (required for /claim)
 *   ADMIN_PRIVATE_KEY   — admin P-256 privkey JWK string (required for /claim)
 *   ENABLE_CLAIM        — set to "true" to enable POST /claim (default: false)
 *   CLAIMS_DB_PATH      — sqlite path; default ./data/claims.db
 *   CLAIM_RATE_PER_HOUR — max claims per IP per hour; default 10
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { RitkeyClient } from '@ritkey/sdk';
import { createMcpServer, defaultClient } from './mcp-server.js';
import { signedFetch, type UserKeys } from './auth-p256.js';
import { ClaimStore } from './claim-store.js';
import { provisionUser } from './admin-provision.js';

const PORT = Number(process.env.PORT ?? 3000);
const LEGACY_BEARER = (process.env.MCP_BEARER_TOKEN ?? '').trim();
const API_URL = (process.env.RITKEY_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const ENABLE_CLAIM = (process.env.ENABLE_CLAIM ?? '').toLowerCase() === 'true';
const ADMIN_PUBLIC_KEY = (process.env.ADMIN_PUBLIC_KEY ?? '').trim();
const ADMIN_PRIVATE_KEY = (process.env.ADMIN_PRIVATE_KEY ?? '').trim();
const CLAIMS_DB_PATH = process.env.CLAIMS_DB_PATH ?? './data/claims.db';
const CLAIM_RATE_PER_HOUR = Number(process.env.CLAIM_RATE_PER_HOUR ?? 10);

if (!LEGACY_BEARER && !ENABLE_CLAIM) {
  console.error('Neither MCP_BEARER_TOKEN nor ENABLE_CLAIM=true is set — service has no usable auth path');
  process.exit(1);
}
if (ENABLE_CLAIM && (!ADMIN_PUBLIC_KEY || !ADMIN_PRIVATE_KEY)) {
  console.error('ENABLE_CLAIM=true requires ADMIN_PUBLIC_KEY and ADMIN_PRIVATE_KEY');
  process.exit(1);
}

const claims = ENABLE_CLAIM ? new ClaimStore(CLAIMS_DB_PATH) : null;
const adminKeys: UserKeys | null =
  ENABLE_CLAIM ? { publicKey: ADMIN_PUBLIC_KEY, privateKey: ADMIN_PRIVATE_KEY } : null;

// session id → transport (per the MCP spec each client needs its own pair)
const transports = new Map<string, StreamableHTTPServerTransport>();

// Naive per-IP rate limit for /claim (in-memory, resets on restart — fine for now)
const claimHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = claimHits.get(ip);
  if (!entry || entry.resetAt < now) {
    claimHits.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return false;
  }
  if (entry.count >= CLAIM_RATE_PER_HOUR) return true;
  entry.count += 1;
  return false;
}

function buildClientForBearer(bearer: string): RitkeyClient | null {
  // Claim path
  if (claims) {
    const claimed = claims.lookup(bearer);
    if (claimed) {
      const userKeys: UserKeys = { publicKey: claimed.publicKey, privateKey: claimed.privateKey };
      return new RitkeyClient({
        baseUrl: claimed.walletServiceUrl,
        fetch: signedFetch(claimed.walletServiceUrl, userKeys),
      });
    }
  }
  // Legacy path
  if (LEGACY_BEARER && bearer === LEGACY_BEARER) {
    return defaultClient();
  }
  return null;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      if (!buf) return resolve(undefined);
      try { resolve(JSON.parse(buf)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  // Permissive for the demo — anyone can call /claim from a browser.
  // Reflect origin so credentials can be carried by clients that need them.
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-session-id',
    'Access-Control-Expose-Headers': 'mcp-session-id',
    'Access-Control-Max-Age': '86400',
  };
}

async function createSession(client: RitkeyClient): Promise<StreamableHTTPServerTransport> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      transports.set(sid, transport);
      console.log(`[mcp-http] session opened ${sid} (active=${transports.size})`);
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) {
      transports.delete(transport.sessionId);
      console.log(`[mcp-http] session closed ${transport.sessionId} (active=${transports.size})`);
    }
  };
  const server = createMcpServer(client);
  await server.connect(transport);
  return transport;
}

const httpServer = http.createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  const origin = req.headers.origin;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  // Add CORS headers to every response
  const cors = corsHeaders(origin);

  if (url === '/health') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      target: API_URL,
      sessions: transports.size,
      claims_enabled: ENABLE_CLAIM,
      claims_issued: claims?.count() ?? 0,
    }));
    return;
  }

  // ── POST /claim ──────────────────────────────────────────
  if (url === '/claim' && req.method === 'POST') {
    if (!ENABLE_CLAIM || !claims || !adminKeys) {
      Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
      return json(res, 503, { error: 'claim_disabled' });
    }
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';
    if (rateLimited(ip)) {
      Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
      return json(res, 429, { error: 'rate_limited', retry_after_seconds: 3600 });
    }
    try {
      const bearer = ClaimStore.newBearer();
      const provisioned = await provisionUser(API_URL, adminKeys, `claim-${bearer.slice(0, 8)}`);
      claims.insert({
        bearer,
        userId: provisioned.userId,
        publicKey: provisioned.publicKey,
        privateKey: provisioned.privateKey,
        walletServiceUrl: API_URL,
      });
      Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
      return json(res, 200, {
        bearer,
        endpoint: `${getPublicBase(req)}/mcp`,
        note: 'Save this bearer. It is the only key to your wallet on this service.',
      });
    } catch (err) {
      console.error('[mcp-http] /claim failed:', err);
      Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
      return json(res, 500, { error: 'provision_failed', message: (err as Error).message });
    }
  }

  if (url !== '/mcp') {
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    return json(res, 404, { error: 'not_found' });
  }

  // ── /mcp — auth & route to a session ────────────────────
  const auth = req.headers.authorization ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const client = buildClientForBearer(bearer);
  if (!client) {
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    return json(res, 401, { error: 'unauthorized' });
  }

  try {
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    const sid = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sid) ? sid[0] : sid;

    let transport: StreamableHTTPServerTransport | undefined;
    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId);
    } else if (!sessionId && req.method === 'POST' && isInitializeRequest(body)) {
      transport = await createSession(client);
    } else {
      Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
      return json(res, 400, {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: missing or invalid session id' },
        id: null,
      });
    }

    // Add CORS headers to the streaming response
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    await transport!.handleRequest(req, res, body);
  } catch (err) {
    console.error('[mcp-http] request failed', err);
    if (!res.headersSent) {
      Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
      json(res, 500, { error: 'internal_error' });
    }
  }
});

function getPublicBase(req: http.IncomingMessage): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  const host = req.headers.host ?? `localhost:${PORT}`;
  return `${proto}://${host}`;
}

httpServer.listen(PORT, () => {
  console.log(`[ritual-agent-wallet] MCP HTTP server listening on :${PORT}`);
  console.log(`[ritual-agent-wallet] Forwarding tool calls to ${API_URL}`);
  console.log(`[ritual-agent-wallet] Claim mode: ${ENABLE_CLAIM ? 'ON' : 'OFF (legacy bearer only)'}`);
  if (ENABLE_CLAIM) console.log(`[ritual-agent-wallet] Claims DB: ${CLAIMS_DB_PATH}`);
});
