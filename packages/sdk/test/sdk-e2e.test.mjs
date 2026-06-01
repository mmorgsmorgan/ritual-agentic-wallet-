/**
 * SDK end-to-end test.
 *
 * Spins up @ritkey/service in-process, then drives it through the
 * @ritkey/sdk public API:
 *
 *   - create wallet
 *   - list wallets
 *   - get specific wallet
 *   - register webhook
 *   - fire test event
 *   - verify the received delivery with verifyWebhook() (the receiver helper)
 *   - poll events via EventsClient
 *   - export key + confirm wallet archived
 *
 * Uses node:test (built-in).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { unlinkSync, existsSync, mkdirSync } from 'node:fs';

// Configure environment for the service BEFORE importing it.
process.env.API_KEY = 'sdk-e2e-test-key';
process.env.ENCRYPTION_KEY = '0'.repeat(63) + '3';
process.env.DATABASE_PATH = './data/test-sdk.db';
process.env.NODE_ENV = 'development';
process.env.RITKEY_ALLOW_INSECURE_WEBHOOKS = 'true';

if (existsSync(process.env.DATABASE_PATH)) unlinkSync(process.env.DATABASE_PATH);
mkdirSync('./data', { recursive: true });

const { createApp } = await import('../../service/dist/api/server.js');
const { initDatabase } = await import('../../service/dist/db/database.js');
const { stopDeliveryWorker, processPendingDeliveries } = await import(
  '../../service/dist/events/delivery.js'
);

const { RitkeyClient, verifyWebhook, isEvent } = await import('../dist/index.js');

initDatabase(process.env.DATABASE_PATH);
const app = createApp();

// Start the service on a random port.
const serviceServer = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const baseUrl = `http://127.0.0.1:${serviceServer.address().port}`;

// Start a receiver server that captures webhook POSTs.
const received = [];
const receiver = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push({ url: req.url, headers: req.headers, body });
    res.writeHead(200);
    res.end('{}');
  });
});
await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
const receiverUrl = `http://127.0.0.1:${receiver.address().port}/hook`;

test.after(() => {
  stopDeliveryWorker();
  serviceServer.close();
  receiver.close();
});

const client = new RitkeyClient({
  baseUrl,
  apiKey: process.env.API_KEY,
});

let walletA;
let webhookSubA;

test('client.wallets.create returns shares + threshold metadata', async () => {
  walletA = await client.wallets.create({ label: 'sdk-test' });
  assert.equal(walletA.walletType, 'threshold');
  assert.equal(walletA.threshold, 2);
  assert.equal(walletA.totalShares, 3);
  assert.ok(walletA.walletId);
  assert.ok(walletA.address.startsWith('0x'));
  assert.ok(walletA.agentShard.startsWith('0x'));
  assert.ok(walletA.backupShard.startsWith('0x'));
});

test('client.wallets.list returns the wallet we just created', async () => {
  const r = await client.wallets.list();
  assert.ok(r.count >= 1);
  assert.ok(r.wallets.find((w) => w.id === walletA.walletId));
});

test('client.wallets.get returns this wallet', async () => {
  const w = await client.wallets.get(walletA.walletId);
  assert.equal(w.id, walletA.walletId);
  assert.equal(w.address, walletA.address);
  assert.equal(w.status, 'active');
});

test('client.wallets.me returns the wallet bound to this API key', async () => {
  const w = await client.wallets.me();
  assert.equal(w.id, walletA.walletId);
});

test('client.webhooks.create returns a one-time secret', async () => {
  webhookSubA = await client.webhooks.create({
    url: receiverUrl,
    events: ['*'],
    label: 'sdk-test',
  });
  assert.ok(webhookSubA.id);
  assert.ok(webhookSubA.secret.startsWith('whsec_'));
  assert.deepEqual(webhookSubA.eventsFilter, ['*']);
});

test('client.webhooks.list excludes the secret', async () => {
  const r = await client.webhooks.list();
  const found = r.subscriptions.find((s) => s.id === webhookSubA.id);
  assert.ok(found);
  assert.equal(found.secret, undefined);
});

test('client.webhooks.listEventTypes returns the catalog', async () => {
  const r = await client.webhooks.listEventTypes();
  assert.ok(r.eventTypes.includes('tx.sent'));
  assert.ok(r.eventTypes.includes('wallet.created'));
  assert.equal(r.wildcard, '*');
});

test('client.webhooks.test triggers a delivery to receiver', async () => {
  const before = received.length;
  const r = await client.webhooks.test(webhookSubA.id);
  assert.ok(r.eventId);
  // Force delivery (avoid 1.5s poll wait)
  await processPendingDeliveries();
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(received.length > before, 'no webhook delivered');
});

test('verifyWebhook accepts the delivery with correct secret', () => {
  const hook = received[received.length - 1];
  const sig = hook.headers['ritkey-signature'];
  const result = verifyWebhook(hook.body, sig, webhookSubA.secret);
  assert.equal(result.ok, true, `verify failed: ${!result.ok ? result.reason : ''}`);
  assert.equal(result.event.type, 'webhook.test');
  assert.ok(isEvent(result.event, 'webhook.test'));
});

test('verifyWebhook rejects a tampered payload', () => {
  const hook = received[received.length - 1];
  const sig = hook.headers['ritkey-signature'];
  const tampered = hook.body.replace(/"webhook.test"/, '"tx.sent"');
  const result = verifyWebhook(tampered, sig, webhookSubA.secret);
  assert.equal(result.ok, false);
});

test('verifyWebhook rejects with wrong secret', () => {
  const hook = received[received.length - 1];
  const sig = hook.headers['ritkey-signature'];
  const result = verifyWebhook(hook.body, sig, 'whsec_wrong');
  assert.equal(result.ok, false);
});

test('verifyWebhook rejects old timestamps (replay)', () => {
  const hook = received[received.length - 1];
  const sig = hook.headers['ritkey-signature'];
  // Pretend "now" is 1 hour after the signed timestamp -> outside 5min window.
  const t = parseInt(sig.match(/t=(\d+)/)[1], 10);
  const result = verifyWebhook(hook.body, sig, webhookSubA.secret, {
    nowSeconds: t + 3600,
  });
  assert.equal(result.ok, false);
});

test('client.webhooks.listDeliveries shows the delivery as delivered', async () => {
  const r = await client.webhooks.listDeliveries(webhookSubA.id);
  assert.ok(r.deliveries.length >= 1);
  const delivered = r.deliveries.find((d) => d.status === 'delivered');
  assert.ok(delivered, 'expected at least one delivered entry');
});

test('client.events.list returns recent events', async () => {
  const events = await client.events.list({ limit: 10 });
  assert.ok(events.length > 0);
  assert.ok(events.find((e) => e.type === 'wallet.created'));
});

test('client.events.subscribe emits only NEW events', async () => {
  const seen = [];
  const stop = client.events.subscribe({
    intervalMs: 200,
    onEvent: (e) => seen.push(e),
  });
  // Wait for first poll (primes the seen-set) and for at least one interval.
  await new Promise((r) => setTimeout(r, 400));

  // Now fire an event the poller should observe.
  await client.webhooks.test(webhookSubA.id);
  await new Promise((r) => setTimeout(r, 800));
  stop();
  assert.ok(seen.length > 0, 'poller received no events');
  assert.ok(seen.find((e) => e.type === 'webhook.test'));
});

test('client.wallets.exportKey archives the wallet', async () => {
  const r = await client.wallets.exportKey({
    walletId: walletA.walletId,
    agentShard: walletA.agentShard,
  });
  assert.ok(r.privateKey.startsWith('0x'));
  assert.equal(r.status, 'archived');

  const w = await client.wallets.get(walletA.walletId);
  assert.equal(w.status, 'archived');
});

test('client.wallets.send rejects on archived wallet', async () => {
  await assert.rejects(
    () =>
      client.wallets.send({
        walletId: walletA.walletId,
        agentShard: walletA.agentShard,
        to: '0x' + 'a'.repeat(40),
        value: '0.001',
      }),
    (err) => err.status === 403
  );
});

test('client.webhooks.delete removes the subscription', async () => {
  await client.webhooks.delete(webhookSubA.id);
  const r = await client.webhooks.list();
  assert.ok(!r.subscriptions.find((s) => s.id === webhookSubA.id));
});

test('RitkeyError carries status and code', async () => {
  // GET a wallet that doesn't exist.
  await assert.rejects(
    () => client.wallets.get('does-not-exist'),
    (err) => err.status === 404
  );
});
