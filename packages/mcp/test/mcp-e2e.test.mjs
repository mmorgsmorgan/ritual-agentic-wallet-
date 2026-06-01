/**
 * MCP end-to-end test.
 *
 * Spins up @ritkey/service in-process, then launches the MCP server as
 * a child process configured to talk to that service. Drives the MCP
 * server via stdio JSON-RPC and round-trips a create_wallet + get_balance
 * call.
 *
 * Confirms: MCP tool -> SDK -> HTTP -> service -> SDK response -> MCP result.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { unlinkSync, existsSync, mkdirSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(__dirname, '..', 'dist', 'mcp', 'index.js');

process.env.API_KEY = 'mcp-e2e-test-key';
process.env.ENCRYPTION_KEY = '0'.repeat(63) + '4';
process.env.DATABASE_PATH = './data/test-mcp-e2e.db';
process.env.NODE_ENV = 'development';
process.env.RITKEY_ALLOW_INSECURE_WEBHOOKS = 'true';

if (existsSync(process.env.DATABASE_PATH)) unlinkSync(process.env.DATABASE_PATH);
mkdirSync('./data', { recursive: true });

const { createApp } = await import('../../service/dist/api/server.js');
const { initDatabase } = await import('../../service/dist/db/database.js');
const { stopDeliveryWorker } = await import('../../service/dist/events/delivery.js');
const { stopBalancePoller } = await import('../../service/dist/events/balance-poller.js');

initDatabase(process.env.DATABASE_PATH);
const app = createApp();
const serviceServer = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const baseUrl = `http://127.0.0.1:${serviceServer.address().port}`;

let mcpChild;
let nextRpcId = 100;

async function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextRpcId++;
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            mcpChild.stdout.off('data', onData);
            resolve(msg);
            return;
          }
        } catch {}
      }
    };
    mcpChild.stdout.on('data', onData);
    mcpChild.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
    );
    setTimeout(() => {
      mcpChild.stdout.off('data', onData);
      reject(new Error(`rpc(${method}) timeout`));
    }, 8000);
  });
}

test('boot MCP child wired to live service', async () => {
  mcpChild = spawn('node', [entry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      RITKEY_API_URL: baseUrl,
      RITKEY_API_KEY: process.env.API_KEY,
    },
  });

  // Handshake.
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mcp-e2e', version: '1.0' },
  });
  assert.equal(init.result.serverInfo.name, 'ritual-agent-wallet');
  mcpChild.stdin.write(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }) + '\n'
  );
});

let walletId;
let walletAddress;

test('create_wallet via MCP creates wallet through SDK -> service', async () => {
  const resp = await rpc('tools/call', {
    name: 'create_wallet',
    arguments: { label: 'mcp-e2e-test' },
  });

  assert.ok(!resp.result.isError, `tool errored: ${JSON.stringify(resp.result)}`);
  const text = resp.result.content[0].text;
  const data = JSON.parse(text);
  assert.ok(data.walletId);
  assert.ok(data.address.startsWith('0x'));
  assert.ok(data.agentShard);
  assert.ok(data.backupShard);
  walletId = data.walletId;
  walletAddress = data.address;
});

test('list_wallets via MCP shows the created wallet', async () => {
  const resp = await rpc('tools/call', {
    name: 'list_wallets',
    arguments: {},
  });
  assert.ok(!resp.result.isError);
  const data = JSON.parse(resp.result.content[0].text);
  assert.ok(data.wallets.some((w) => w.id === walletId));
});

test('get_balance via MCP returns balance struct (will be 0)', async () => {
  const resp = await rpc('tools/call', {
    name: 'get_balance',
    arguments: { walletId },
  });
  // Balance call may fail because RPC is unreachable. We accept either:
  //   - success: balance returned (means RPC worked, very unlikely in CI)
  //   - error: get_balance_failed (expected when offline)
  // The point is the MCP -> SDK -> service plumbing executed.
  const text = resp.result.content[0].text;
  const data = JSON.parse(text);
  if (resp.result.isError) {
    assert.equal(data.error, 'get_balance_failed');
  } else {
    assert.ok(typeof data.nativeBalance === 'string');
  }
});

test('create_alert_rule via MCP wires up to alerts service', async () => {
  const resp = await rpc('tools/call', {
    name: 'create_alert_rule',
    arguments: {
      walletId,
      kind: 'spend_threshold',
      config: { thresholdRitual: '0.1' },
      severity: 'warn',
    },
  });
  assert.ok(!resp.result.isError, `tool errored: ${resp.result.content[0].text}`);
  const data = JSON.parse(resp.result.content[0].text);
  assert.equal(data.kind, 'spend_threshold');
  assert.equal(data.walletId, walletId);
});

test('list_alert_rules via MCP returns the rule', async () => {
  const resp = await rpc('tools/call', {
    name: 'list_alert_rules',
    arguments: { walletId },
  });
  assert.ok(!resp.result.isError);
  const data = JSON.parse(resp.result.content[0].text);
  assert.equal(data.count, 1);
  assert.equal(data.rules[0].kind, 'spend_threshold');
});

test('teardown', () => {
  if (mcpChild) mcpChild.kill('SIGTERM');
  stopBalancePoller();
  stopDeliveryWorker();
  serviceServer.close();
});
