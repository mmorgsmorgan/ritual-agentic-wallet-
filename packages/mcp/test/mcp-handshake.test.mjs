/**
 * MCP smoke test — drives the server via stdio JSON-RPC.
 *
 * Verifies the rewritten MCP server:
 *   1. Accepts an `initialize` request and responds with serverInfo
 *   2. Lists all expected wallet/webhook/alert tools via tools/list
 *
 * Does NOT exercise the tools end-to-end — that requires a running
 * @ritkey/service. The handshake alone confirms the module loads cleanly
 * and all tools are registered.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(__dirname, '..', 'dist', 'mcp', 'index.js');

function spawnMcp() {
  return spawn('node', [entry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, RITKEY_API_URL: 'http://localhost:9999' },
  });
}

function sendAndCollect(child, messages, expectedIds) {
  return new Promise((resolve, reject) => {
    const responses = new Map();
    let buf = '';
    let timeout;

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id != null) responses.set(msg.id, msg);
          if (expectedIds.every((id) => responses.has(id))) {
            clearTimeout(timeout);
            resolve(responses);
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (!expectedIds.every((id) => responses.has(id))) {
        reject(new Error(`mcp exited (${code}) before all responses arrived`));
      }
    });

    for (const m of messages) {
      child.stdin.write(JSON.stringify(m) + '\n');
    }

    timeout = setTimeout(() => {
      reject(new Error('mcp did not respond within 15s'));
    }, 15000);
  });
}

test('MCP server responds to initialize and lists all tools', async () => {
  const child = spawnMcp();
  try {
    const responses = await sendAndCollect(
      child,
      [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'mcp-smoke', version: '1.0' },
          },
        },
        {
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {},
        },
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      ],
      [1, 2]
    );

    const init = responses.get(1);
    assert.equal(init.result.serverInfo.name, 'ritual-agent-wallet');

    const toolsResp = responses.get(2);
    const tools = toolsResp.result.tools.map((t) => t.name);

    const expectedWalletTools = [
      'create_wallet',
      'import_wallet',
      'list_wallets',
      'get_wallet_info',
      'get_balance',
      'send_transaction',
      'sign_message',
      'fund_wallet',
      'export_key',
      'sweep_and_archive',
    ];
    const expectedWebhookTools = [
      'create_webhook',
      'list_webhooks',
      'update_webhook',
      'delete_webhook',
      'test_webhook',
    ];
    const expectedAlertTools = [
      'create_alert_rule',
      'list_alert_rules',
      'update_alert_rule',
      'delete_alert_rule',
    ];
    const expectedEventTools = ['list_events'];
    const expectedSkillTools = [
      'list_ritual_skills',
      'read_ritual_skill',
      'read_ritual_rules',
    ];
    const expectedMeta = ['get_chain_info'];

    const all = [
      ...expectedWalletTools,
      ...expectedWebhookTools,
      ...expectedAlertTools,
      ...expectedEventTools,
      ...expectedSkillTools,
      ...expectedMeta,
    ];
    for (const name of all) {
      assert.ok(
        tools.includes(name),
        `missing tool: ${name} (got: ${tools.join(', ')})`
      );
    }
  } finally {
    child.kill('SIGTERM');
  }
});
