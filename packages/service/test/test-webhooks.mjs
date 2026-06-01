#!/usr/bin/env node
/**
 * End-to-end webhook test.
 *
 * 1. Spin up an in-process Express app via createApp()
 * 2. Spin up a separate local "receiver" server to capture deliveries
 * 3. Register a webhook subscription pointing at the receiver
 * 4. Trigger events (create wallet, fire test event)
 * 5. Verify deliveries arrive with valid HMAC signatures
 */

import http from 'node:http';
import { createHmac } from 'node:crypto';
import { unlinkSync, existsSync, mkdirSync } from 'node:fs';

// Configure environment BEFORE importing the app
process.env.API_KEY = 'test-webhook-key-1234567890';
process.env.ENCRYPTION_KEY = '0'.repeat(63) + '1';
process.env.DATABASE_PATH = './data/test-webhooks.db';
process.env.NODE_ENV = 'development'; // allow http:// webhook URLs
process.env.RITKEY_ALLOW_INSECURE_WEBHOOKS = 'true';

if (existsSync(process.env.DATABASE_PATH)) {
  unlinkSync(process.env.DATABASE_PATH);
}
mkdirSync('./data', { recursive: true });

const { createApp } = await import('../dist/api/server.js');
const { initDatabase } = await import('../dist/db/database.js');
const { processPendingDeliveries, stopDeliveryWorker } = await import('../dist/events/delivery.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { console.log(`✅ ${name}`); passed++; },
    (err) => { console.log(`❌ ${name}: ${err.message}`); failed++; }
  );
}

// ============================================================
// Set up receiver server to capture webhooks
// ============================================================

const receivedWebhooks = [];

const receiver = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => body += chunk);
  req.on('end', () => {
    receivedWebhooks.push({
      url: req.url,
      headers: req.headers,
      body,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true }));
  });
});

await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
const receiverPort = receiver.address().port;
const receiverUrl = `http://127.0.0.1:${receiverPort}/webhook`;
console.log(`Receiver listening on ${receiverUrl}\n`);

// ============================================================
// Set up Ritkey app
// ============================================================

initDatabase(process.env.DATABASE_PATH);
const app = createApp();

const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
console.log(`Ritkey app listening on ${baseUrl}\n`);

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

async function apiUnauth(method, path, body) {
  // No auth header — for testing OPEN_MODE rejection
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

// ============================================================
// Tests
// ============================================================

console.log('=== Ritkey Webhook End-to-End Test ===\n');

let subscription;

await test('GET /webhooks/events lists supported event types', async () => {
  const r = await api('GET', '/webhooks/events');
  if (r.status !== 200) throw new Error(`Got ${r.status}`);
  if (!r.body.eventTypes?.includes('wallet.created')) {
    throw new Error('Missing wallet.created in event types');
  }
});

await test('POST /webhooks creates a subscription with secret', async () => {
  const r = await api('POST', '/webhooks', {
    url: receiverUrl,
    events: ['*'],
    label: 'test',
  });
  if (r.status !== 201) throw new Error(`Got ${r.status}: ${JSON.stringify(r.body)}`);
  if (!r.body.secret?.startsWith('whsec_')) throw new Error('Missing secret');
  if (!r.body.id) throw new Error('Missing id');
  subscription = r.body;
});

await test('GET /webhooks lists my subscriptions (no secret leaked)', async () => {
  const r = await api('GET', '/webhooks');
  if (r.body.count !== 1) throw new Error(`Expected 1 sub, got ${r.body.count}`);
  if (r.body.subscriptions[0].secret) throw new Error('Secret should NOT be returned on list');
});

await test('POST /webhooks/:id/test fires a webhook.test event', async () => {
  const before = receivedWebhooks.length;
  const r = await api('POST', `/webhooks/${subscription.id}/test`);
  if (r.status !== 200) throw new Error(`Got ${r.status}`);

  // Force delivery now, then wait briefly for the receiver to log it
  await processPendingDeliveries();
  await new Promise((r) => setTimeout(r, 200));

  if (receivedWebhooks.length <= before) {
    throw new Error('No webhook delivered');
  }
});

await test('Delivered webhook has valid HMAC signature', async () => {
  const hook = receivedWebhooks[receivedWebhooks.length - 1];
  const sig = hook.headers['ritkey-signature'];
  if (!sig) throw new Error('Missing Ritkey-Signature header');

  const m = sig.match(/^t=(\d+),v1=([a-f0-9]+)$/);
  if (!m) throw new Error(`Bad signature format: ${sig}`);

  const [, t, v1] = m;
  const expected = createHmac('sha256', subscription.secret)
    .update(`${t}.${hook.body}`)
    .digest('hex');

  if (expected !== v1) throw new Error('HMAC signature mismatch');
});

await test('Webhook body contains valid event payload', async () => {
  const hook = receivedWebhooks[receivedWebhooks.length - 1];
  const event = JSON.parse(hook.body);
  if (event.type !== 'webhook.test') throw new Error(`Expected webhook.test, got ${event.type}`);
  if (!event.id) throw new Error('Missing event id');
  if (!event.timestamp) throw new Error('Missing event timestamp');
});

await test('Creating a wallet fires wallet.created webhook', async () => {
  const before = receivedWebhooks.length;
  const r = await api('POST', '/wallets', { label: 'webhook-test' });
  if (r.status !== 201) throw new Error(`Wallet create failed: ${r.status}`);

  await processPendingDeliveries();
  await new Promise((r) => setTimeout(r, 200));

  const after = receivedWebhooks.length;
  if (after <= before) throw new Error('No webhook fired');

  const lastHook = JSON.parse(receivedWebhooks[after - 1].body);
  if (lastHook.type !== 'wallet.created') {
    throw new Error(`Expected wallet.created, got ${lastHook.type}`);
  }
  if (lastHook.data.walletType !== 'threshold') {
    throw new Error(`Expected threshold wallet, got ${lastHook.data.walletType}`);
  }
});

await test('Event filter excludes non-matching events', async () => {
  // Update sub to only listen for tx.sent
  const r = await api('PATCH', `/webhooks/${subscription.id}`, { events: ['tx.sent'] });
  if (r.status !== 200) throw new Error(`Patch failed: ${r.status}`);

  const before = receivedWebhooks.length;

  // Create another wallet — this emits wallet.created via the global event bus.
  // Our sub filters for tx.sent only, so it should NOT fire.
  // (Note: /webhooks/:id/test is direct-enqueue per H6 — always delivers regardless
  // of filter — so we can't use it for filter testing.)
  await api('POST', '/wallets', { label: 'filter-test' });
  await processPendingDeliveries();
  await new Promise((r) => setTimeout(r, 200));

  if (receivedWebhooks.length > before) {
    throw new Error('Received non-matching event');
  }
});

await test('GET /webhooks/:id/deliveries shows delivery log', async () => {
  const r = await api('GET', `/webhooks/${subscription.id}/deliveries`);
  if (r.status !== 200) throw new Error(`Got ${r.status}`);
  if (r.body.count < 1) throw new Error('Expected at least one delivery in log');

  const delivered = r.body.deliveries.find((d) => d.status === 'delivered');
  if (!delivered) throw new Error('No delivered entry in log');
  if (delivered.responseStatus !== 200) {
    throw new Error(`Expected 200 response status, got ${delivered.responseStatus}`);
  }
});

await test('DELETE /webhooks/:id removes subscription', async () => {
  const r = await api('DELETE', `/webhooks/${subscription.id}`);
  if (r.status !== 204) throw new Error(`Got ${r.status}`);
  const list = await api('GET', '/webhooks');
  if (list.body.count !== 0) throw new Error('Subscription still exists');
});

// ============================================================
// Summary
// ============================================================

console.log(`\n=== Test Summary ===`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📥 Webhooks received: ${receivedWebhooks.length}`);

stopDeliveryWorker();
server.close();
receiver.close();

process.exit(failed === 0 ? 0 : 1);
