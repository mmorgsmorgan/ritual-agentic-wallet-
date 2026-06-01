/**
 * Alert engine end-to-end test.
 *
 * Verifies:
 *   - spend_threshold rule fires alert.spend_threshold on tx.sent > threshold
 *   - unusual_recipient rule fires alert.unusual_recipient when 'to' not in whitelist
 *   - key_export_warning rule fires alert.key_export_warning on /export-key
 *   - alerts are deliverable via webhook (round-trip through delivery worker)
 *   - rules respect enabled flag
 *   - rules are owner-scoped (other API key cannot see them)
 *
 * Spins up @ritkey/service in-process and drives via @ritkey/sdk.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { unlinkSync, existsSync, mkdirSync } from 'node:fs';

process.env.API_KEY = 'sdk-alerts-test-key';
process.env.ENCRYPTION_KEY = '0'.repeat(63) + '4';
process.env.DATABASE_PATH = './data/test-alerts.db';
process.env.NODE_ENV = 'development';
process.env.RITKEY_ALLOW_INSECURE_WEBHOOKS = 'true';

if (existsSync(process.env.DATABASE_PATH)) unlinkSync(process.env.DATABASE_PATH);
mkdirSync('./data', { recursive: true });

const { createApp } = await import('../../service/dist/api/server.js');
const { initDatabase } = await import('../../service/dist/db/database.js');
const { stopDeliveryWorker, processPendingDeliveries } = await import(
  '../../service/dist/events/delivery.js'
);
const { emitEvent } = await import('../../service/dist/events/emitter.js');

const { RitkeyClient, verifyWebhook } = await import('../dist/index.js');

initDatabase(process.env.DATABASE_PATH);
const app = createApp();
const serviceServer = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const baseUrl = `http://127.0.0.1:${serviceServer.address().port}`;

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
  stopDeliveryWorker();
  serviceServer.close();
  receiver.close();
});

const client = new RitkeyClient({ baseUrl, apiKey: process.env.API_KEY });

let wallet;
let webhookSub;
let spendRule;

test('setup: create wallet + webhook listening to alert.*', async () => {
  wallet = await client.wallets.create({ label: 'alerts-test' });
  webhookSub = await client.webhooks.create({
    url: receiverUrl,
    events: ['alert.spend_threshold', 'alert.unusual_recipient', 'alert.key_export_warning'],
  });
  assert.ok(wallet.walletId);
  assert.ok(webhookSub.secret.startsWith('whsec_'));
});

test('client.alerts.create registers a spend_threshold rule', async () => {
  spendRule = await client.alerts.create({
    walletId: wallet.walletId,
    kind: 'spend_threshold',
    config: { thresholdRitual: '0.05' },
    severity: 'warn',
    label: 'mid-value spend',
  });
  assert.equal(spendRule.kind, 'spend_threshold');
  assert.equal(spendRule.walletId, wallet.walletId);
  assert.equal(spendRule.severity, 'warn');
  assert.equal(spendRule.enabled, true);
});

test('client.alerts.list returns the rule', async () => {
  const r = await client.alerts.list();
  assert.ok(r.rules.find((x) => x.id === spendRule.id));
});

test('client.alerts.listForWallet returns wallet-scoped rules', async () => {
  const r = await client.alerts.listForWallet(wallet.walletId);
  assert.equal(r.count, 1);
  assert.equal(r.rules[0].id, spendRule.id);
});

test('tx.sent ABOVE threshold fires alert.spend_threshold', async () => {
  // We can't actually do an on-chain send without RPC + funds, so synthesize
  // a tx.sent event via the emitter (mirrors what /wallets/:id/send does).
  const before = received.length;

  emitEvent({
    type: 'tx.sent',
    walletId: wallet.walletId,
    data: {
      walletId: wallet.walletId,
      hash: '0xfeedface' + 'a'.repeat(56),
      from: wallet.address,
      to: '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0',
      value: '500000000000000000',  // 0.5 RITUAL in wei
      valueFormatted: '0.5',         // > 0.05 threshold -> ALERT
      data: '0x',
      explorer: 'https://example/tx/fake',
    },
  });

  await processPendingDeliveries();
  await new Promise((r) => setTimeout(r, 200));

  // Look for an alert.spend_threshold delivery (the tx.sent itself isn't in
  // the webhook filter, so only the alert should appear).
  const alertDelivery = received
    .slice(before)
    .map((h) => JSON.parse(h.body))
    .find((e) => e.type === 'alert.spend_threshold');

  assert.ok(alertDelivery, 'no alert.spend_threshold delivered');
  assert.equal(alertDelivery.data.ruleId, spendRule.id);
  assert.equal(alertDelivery.data.txValueRitual, '0.5');
  assert.equal(alertDelivery.data.thresholdRitual, '0.05');
});

test('tx.sent BELOW threshold does NOT fire', async () => {
  const before = received.length;

  emitEvent({
    type: 'tx.sent',
    walletId: wallet.walletId,
    data: {
      walletId: wallet.walletId,
      hash: '0xc0ffee' + 'b'.repeat(58),
      from: wallet.address,
      to: '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0',
      value: '10000000000000000',
      valueFormatted: '0.01',  // < 0.05 -> no alert
      data: '0x',
      explorer: 'https://example/tx/cheap',
    },
  });

  await processPendingDeliveries();
  await new Promise((r) => setTimeout(r, 200));

  const newDeliveries = received.slice(before).map((h) => JSON.parse(h.body));
  const alert = newDeliveries.find((e) => e.type === 'alert.spend_threshold');
  assert.equal(alert, undefined, 'spurious alert below threshold');
});

test('unusual_recipient rule fires when "to" not in whitelist', async () => {
  await client.alerts.create({
    walletId: wallet.walletId,
    kind: 'unusual_recipient',
    config: {
      whitelist: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    },
    severity: 'critical',
  });

  const before = received.length;

  emitEvent({
    type: 'tx.sent',
    walletId: wallet.walletId,
    data: {
      walletId: wallet.walletId,
      hash: '0xd00d' + 'c'.repeat(60),
      from: wallet.address,
      to: '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0',  // NOT whitelisted
      value: '100',
      valueFormatted: '0.0001',  // below spend threshold so only unusual_recipient fires
      data: '0x',
      explorer: 'https://example/tx/x',
    },
  });

  await processPendingDeliveries();
  await new Promise((r) => setTimeout(r, 200));

  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const alert = fresh.find((e) => e.type === 'alert.unusual_recipient');
  assert.ok(alert, 'no alert.unusual_recipient delivered');
  assert.equal(alert.data.severity, 'critical');
  assert.equal(alert.data.to, '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0');
});

test('unusual_recipient does NOT fire when "to" is whitelisted', async () => {
  const before = received.length;

  emitEvent({
    type: 'tx.sent',
    walletId: wallet.walletId,
    data: {
      walletId: wallet.walletId,
      hash: '0xfeed' + 'd'.repeat(60),
      from: wallet.address,
      to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',  // whitelisted
      value: '100',
      valueFormatted: '0.001',
      data: '0x',
      explorer: 'https://example/tx/ok',
    },
  });

  await processPendingDeliveries();
  await new Promise((r) => setTimeout(r, 200));

  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const alert = fresh.find((e) => e.type === 'alert.unusual_recipient');
  assert.equal(alert, undefined, 'spurious alert for whitelisted recipient');
});

test('client.alerts.update can disable a rule', async () => {
  const updated = await client.alerts.update(spendRule.id, { enabled: false });
  assert.equal(updated.enabled, false);

  const before = received.length;
  emitEvent({
    type: 'tx.sent',
    walletId: wallet.walletId,
    data: {
      walletId: wallet.walletId,
      hash: '0xdead' + 'e'.repeat(60),
      from: wallet.address,
      to: '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0',
      value: '0',
      valueFormatted: '99',  // way above any threshold
      data: '0x',
      explorer: 'https://example/x',
    },
  });
  await processPendingDeliveries();
  await new Promise((r) => setTimeout(r, 200));

  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const spendAlert = fresh.find((e) => e.type === 'alert.spend_threshold');
  assert.equal(spendAlert, undefined, 'disabled rule still fired');
});

test('key_export_warning rule fires on /export-key', async () => {
  await client.alerts.create({
    walletId: wallet.walletId,
    kind: 'key_export_warning',
    config: {},
    severity: 'critical',
  });

  const before = received.length;

  // Real /export-key call — also archives the wallet.
  await client.wallets.exportKey({
    walletId: wallet.walletId,
    agentShard: wallet.agentShard,
  });

  await processPendingDeliveries();
  await new Promise((r) => setTimeout(r, 300));

  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const alert = fresh.find((e) => e.type === 'alert.key_export_warning');
  assert.ok(alert, 'no alert.key_export_warning delivered after /export-key');
  assert.equal(alert.data.severity, 'critical');
});

test('delivered alerts pass verifyWebhook with the subscription secret', () => {
  const alerts = received
    .map((h) => ({ h, e: JSON.parse(h.body) }))
    .filter((x) => x.e.type.startsWith('alert.'));

  assert.ok(alerts.length > 0);

  for (const { h, e } of alerts) {
    const result = verifyWebhook(h.body, h.headers['ritkey-signature'], webhookSub.secret);
    assert.equal(result.ok, true, `verify failed for ${e.type}`);
  }
});

test('other API key cannot see this owner\'s rules', async () => {
  const otherClient = new RitkeyClient({ baseUrl, apiKey: 'completely-different-key' });
  await assert.rejects(
    () => otherClient.alerts.list(),
    (err) => err.status === 401 || err.status === 403
  );
});

test('client.alerts.delete removes the rule', async () => {
  const stillThere = (await client.alerts.list()).rules.find((r) => r.id === spendRule.id);
  if (stillThere) {
    await client.alerts.delete(spendRule.id);
    const after = (await client.alerts.list()).rules.find((r) => r.id === spendRule.id);
    assert.equal(after, undefined);
  }
});
