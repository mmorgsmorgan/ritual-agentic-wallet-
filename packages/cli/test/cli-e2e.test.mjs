/**
 * CLI end-to-end test.
 *
 * Spins up @ritkey/service in-process, then shells out to the built CLI
 * binary (dist/index.js) with --api-url + --api-key flags and asserts the
 * stdout shape for each subcommand.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { unlinkSync, existsSync, mkdirSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.resolve(__dirname, '..', 'dist', 'index.js');

process.env.API_KEY = 'cli-e2e-test-key';
process.env.ENCRYPTION_KEY = '0'.repeat(63) + '4';
process.env.DATABASE_PATH = './data/test-cli-e2e.db';
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

test.after(() => {
  stopBalancePoller();
  stopDeliveryWorker();
  serviceServer.close();
});

/** Run the CLI and capture stdout / exit code. NO_COLOR to make output assertion-friendly. */
function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      [
        cliEntry,
        '--api-url',
        baseUrl,
        '--api-key',
        process.env.API_KEY,
        ...args,
      ],
      {
        env: { ...process.env, NO_COLOR: '1' },
      }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
    setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('CLI timed out'));
    }, 15000);
  });
}

let walletId;
let walletAddress;
let agentShard;
let ruleId;
let webhookId;

test('ritkey wallets (empty) prints the empty hint', async () => {
  const r = await runCli(['wallets']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /No wallets/);
});

test('ritkey wallet new creates wallet + prints shards', async () => {
  const r = await runCli(['wallet', 'new', '--label', 'cli-test']);
  assert.equal(r.code, 0, r.stderr);
  // Strip ANSI just in case some still slipped through.
  const clean = r.stdout.replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(clean, /Wallet created: 0x[0-9a-fA-F]{40}/);
  assert.match(clean, /walletId\s+[\w-]{36}/);
  assert.match(clean, /agentShard/);
  assert.match(clean, /backupShard/);

  const idMatch = clean.match(/walletId\s+([\w-]{36})/);
  const shardMatch = clean.match(/agentShard\s+([0-9a-fA-F]+)/);
  const addrMatch = clean.match(/Wallet created: (0x[0-9a-fA-F]{40})/);
  walletId = idMatch[1];
  agentShard = shardMatch[1];
  walletAddress = addrMatch[1];
});

test('ritkey wallets (after creation) lists the wallet', async () => {
  const r = await runCli(['wallets']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp(walletAddress));
  assert.match(r.stdout, /cli-test/);
});

test('ritkey alert new --kind spend_threshold creates rule', async () => {
  const r = await runCli([
    'alert',
    'new',
    '--wallet',
    walletId,
    '--kind',
    'spend_threshold',
    '--threshold',
    '0.5',
    '--severity',
    'warn',
  ]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Created alert rule/);
  const m = r.stdout.match(/Created alert rule ([\w-]+)/);
  ruleId = m[1];
});

test('ritkey alerts lists the rule', async () => {
  const r = await runCli(['alerts']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /spend_threshold/);
});

test('ritkey alert toggle disables and then re-enables', async () => {
  let r = await runCli(['alert', 'toggle', ruleId]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /disabled/);
  r = await runCli(['alert', 'toggle', ruleId]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /enabled/);
});

test('ritkey alert rm deletes the rule', async () => {
  const r = await runCli(['alert', 'rm', ruleId]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Deleted/);
});

test('ritkey webhook new --url ... creates subscription', async () => {
  const r = await runCli([
    'webhook',
    'new',
    '--url',
    'http://127.0.0.1:9999/hook',
  ]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Webhook created/);
  assert.match(r.stdout, /secret\s+whsec_/);
  const m = r.stdout.match(/Webhook created: ([\w-]+)/);
  webhookId = m[1];
});

test('ritkey webhooks lists the subscription', async () => {
  const r = await runCli(['webhooks']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /127\.0\.0\.1:9999/);
});

test('ritkey webhook rm deletes the subscription', async () => {
  const r = await runCli(['webhook', 'rm', webhookId]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Deleted/);
});

test('ritkey events lists at least the wallet.created event', async () => {
  const r = await runCli(['events', '--limit', '20']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /wallet\.created/);
});

test('ritkey whoami reports flag-source config', async () => {
  const r = await runCli(['whoami']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /baseUrl:/);
  assert.match(r.stdout, /apiKey:\s+set/);
  assert.match(r.stdout, /source:\s+flags/);
});
