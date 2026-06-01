/**
 * tx.received chain indexer end-to-end test.
 *
 * Verifies the indexer:
 *   - On cold start, records current head WITHOUT replaying history
 *   - When a new block contains a tx to one of our wallet addresses,
 *     emits exactly one alert.received-style event
 *   - Ignores tx whose `to` is not one of our wallets
 *   - Ignores zero-value tx
 *   - Persists the cursor so a second poll doesn't re-emit
 *   - Handles archived wallets correctly (no event for tx to archived addr)
 *   - Catches up over multiple blocks in one tick (up to cap)
 *
 * The block fetcher is mocked so the test never touches RPC.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { parseEther } from 'viem';

process.env.API_KEY = 'sdk-tx-received-test-key';
process.env.ENCRYPTION_KEY = '0'.repeat(63) + '4';
process.env.DATABASE_PATH = './data/test-tx-received.db';
process.env.NODE_ENV = 'development';
process.env.RITKEY_ALLOW_INSECURE_WEBHOOKS = 'true';

if (existsSync(process.env.DATABASE_PATH)) unlinkSync(process.env.DATABASE_PATH);
mkdirSync('./data', { recursive: true });

const { createApp } = await import('../../service/dist/api/server.js');
const { initDatabase } = await import('../../service/dist/db/database.js');
const { stopDeliveryWorker, processPendingDeliveries } = await import(
  '../../service/dist/events/delivery.js'
);
const { stopBalancePoller } = await import('../../service/dist/events/balance-poller.js');
const {
  setBlockFetcher,
  runChainIndexerOnce,
  stopChainIndexer,
} = await import('../../service/dist/events/chain-indexer.js');

const { RitkeyClient } = await import('../dist/index.js');

initDatabase(process.env.DATABASE_PATH);
const app = createApp();
const serviceServer = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const baseUrl = `http://127.0.0.1:${serviceServer.address().port}`;

// Mock chain state — tests control head + per-block tx lists.
let mockHead = 1000n;
const blockTxs = new Map(); // blockNumber (bigint) -> tx[]

setBlockFetcher({
  async getHead() {
    return mockHead;
  },
  async getBlock(n) {
    return { number: n, transactions: blockTxs.get(n) ?? [] };
  },
});

const received = [];
const receiver = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push({ headers: req.headers, body });
    res.writeHead(200);
    res.end('{}');
  });
});
await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
const receiverUrl = `http://127.0.0.1:${receiver.address().port}/hook`;

test.after(() => {
  stopChainIndexer();
  stopBalancePoller();
  stopDeliveryWorker();
  serviceServer.close();
  receiver.close();
});

const client = new RitkeyClient({ baseUrl, apiKey: process.env.API_KEY });

let wallet;

test('setup: create wallet + webhook listening for tx.received', async () => {
  wallet = await client.wallets.create({ label: 'tx-received-test' });
  await client.webhooks.create({
    url: receiverUrl,
    events: ['tx.received'],
  });
});

async function drainDeliveries() {
  await processPendingDeliveries();
  await new Promise((r) => setTimeout(r, 150));
}

test('cold start: records head without replaying history', async () => {
  // History blocks would CONTAIN a tx to the wallet, but indexer must NOT emit
  // them on cold start — only emit blocks after the recorded head.
  blockTxs.set(999n, [
    {
      hash: '0x' + '1'.repeat(64),
      from: '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0',
      to: wallet.address,
      value: parseEther('1'),
    },
  ]);
  mockHead = 1000n;

  const before = received.length;
  await runChainIndexerOnce();
  await drainDeliveries();

  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const txr = fresh.find((e) => e.type === 'tx.received');
  assert.equal(txr, undefined, 'cold start replayed history');
});

test('new block with tx to our wallet -> emits tx.received', async () => {
  blockTxs.set(1001n, [
    {
      hash: '0x' + 'a'.repeat(64),
      from: '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0',
      to: wallet.address,
      value: parseEther('0.5'),
    },
  ]);
  mockHead = 1001n;

  const before = received.length;
  await runChainIndexerOnce();
  await drainDeliveries();

  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const received_events = fresh.filter((e) => e.type === 'tx.received');
  assert.equal(received_events.length, 1, `expected 1, got ${received_events.length}`);
  assert.equal(received_events[0].data.address.toLowerCase(), wallet.address.toLowerCase());
  assert.equal(received_events[0].data.valueFormatted, '0.5');
  assert.equal(received_events[0].data.blockNumber, '1001');
});

test('re-running indexer at same head does NOT re-emit', async () => {
  const before = received.length;
  await runChainIndexerOnce();
  await drainDeliveries();
  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const received_events = fresh.filter((e) => e.type === 'tx.received');
  assert.equal(received_events.length, 0, 'tx.received re-emitted');
});

test('tx to a different (non-wallet) address is ignored', async () => {
  blockTxs.set(1002n, [
    {
      hash: '0x' + 'b'.repeat(64),
      from: wallet.address,
      to: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      value: parseEther('1'),
    },
  ]);
  mockHead = 1002n;

  const before = received.length;
  await runChainIndexerOnce();
  await drainDeliveries();
  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const received_events = fresh.filter((e) => e.type === 'tx.received');
  assert.equal(received_events.length, 0);
});

test('zero-value tx to our wallet is ignored', async () => {
  blockTxs.set(1003n, [
    {
      hash: '0x' + 'c'.repeat(64),
      from: '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0',
      to: wallet.address,
      value: 0n,
    },
  ]);
  mockHead = 1003n;

  const before = received.length;
  await runChainIndexerOnce();
  await drainDeliveries();
  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const received_events = fresh.filter((e) => e.type === 'tx.received');
  assert.equal(received_events.length, 0);
});

test('multi-block catch-up emits one event per matching tx', async () => {
  blockTxs.set(1004n, [
    {
      hash: '0x' + 'd'.repeat(64),
      from: '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0',
      to: wallet.address,
      value: parseEther('0.1'),
    },
  ]);
  blockTxs.set(1005n, [
    {
      hash: '0x' + 'e'.repeat(64),
      from: '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0',
      to: wallet.address,
      value: parseEther('0.2'),
    },
  ]);
  mockHead = 1005n;

  const before = received.length;
  await runChainIndexerOnce();
  await drainDeliveries();
  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const received_events = fresh.filter((e) => e.type === 'tx.received');
  assert.equal(received_events.length, 2, `expected 2 events, got ${received_events.length}`);
  const blockNumbers = received_events.map((e) => e.data.blockNumber).sort();
  assert.deepEqual(blockNumbers, ['1004', '1005']);
});

test('archived wallet is removed from address index — no events emitted', async () => {
  // Archive the wallet via export-key (which marks status='archived').
  await client.wallets.exportKey({
    walletId: wallet.walletId,
    agentShard: wallet.agentShard,
  });

  // Send a new tx to its old address — indexer should ignore it now.
  blockTxs.set(1006n, [
    {
      hash: '0x' + 'f'.repeat(64),
      from: '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0',
      to: wallet.address,
      value: parseEther('1'),
    },
  ]);
  mockHead = 1006n;

  const before = received.length;
  await runChainIndexerOnce();
  await drainDeliveries();
  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const received_events = fresh.filter((e) => e.type === 'tx.received');
  assert.equal(received_events.length, 0, 'archived wallet received tx event');
});
