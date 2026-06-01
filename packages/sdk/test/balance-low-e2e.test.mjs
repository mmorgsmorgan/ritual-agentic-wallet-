/**
 * Balance poller end-to-end test.
 *
 * Verifies the balance_low alert kind:
 *   - fires alert.balance_low once when balance crosses below floor
 *   - does NOT re-fire on subsequent polls while still tripped (hysteresis)
 *   - re-arms after balance recovers above floor * ARM_MARGIN
 *   - fires a second time after re-arming when balance falls again
 *   - respects the enabled flag
 *   - is delivered via the webhook delivery worker
 *
 * The on-chain balance fetcher is mocked so the test never touches RPC.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { unlinkSync, existsSync, mkdirSync } from 'node:fs';

process.env.API_KEY = 'sdk-balance-low-test-key';
process.env.ENCRYPTION_KEY = '0'.repeat(63) + '4';
process.env.DATABASE_PATH = './data/test-balance-low.db';
process.env.NODE_ENV = 'development';
process.env.RITKEY_ALLOW_INSECURE_WEBHOOKS = 'true';

if (existsSync(process.env.DATABASE_PATH)) unlinkSync(process.env.DATABASE_PATH);
mkdirSync('./data', { recursive: true });

const { createApp } = await import('../../service/dist/api/server.js');
const { initDatabase } = await import('../../service/dist/db/database.js');
const { stopDeliveryWorker, processPendingDeliveries } = await import(
  '../../service/dist/events/delivery.js'
);
const { setBalanceFetcher, runBalancePollOnce, stopBalancePoller } =
  await import('../../service/dist/events/balance-poller.js');

const { RitkeyClient } = await import('../dist/index.js');

initDatabase(process.env.DATABASE_PATH);
const app = createApp();
const serviceServer = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const baseUrl = `http://127.0.0.1:${serviceServer.address().port}`;

// Mock balance fetcher: we control returned balance per call.
let nextBalance = '10';
setBalanceFetcher(async () => nextBalance);

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
  stopBalancePoller();
  stopDeliveryWorker();
  serviceServer.close();
  receiver.close();
});

const client = new RitkeyClient({ baseUrl, apiKey: process.env.API_KEY });

let wallet;
let rule;

test('setup: create wallet + webhook + balance_low rule (floor=1 RITUAL)', async () => {
  wallet = await client.wallets.create({ label: 'balance-low-test' });
  await client.webhooks.create({
    url: receiverUrl,
    events: ['alert.balance_low'],
  });
  rule = await client.alerts.create({
    walletId: wallet.walletId,
    kind: 'balance_low',
    config: { floorRitual: '1' },
    severity: 'warn',
  });
  assert.equal(rule.kind, 'balance_low');
  assert.equal(rule.enabled, true);
});

async function pollAndDrain() {
  await runBalancePollOnce();
  await processPendingDeliveries();
  // Tiny settle so the receiver's response handler completes.
  await new Promise((r) => setTimeout(r, 150));
}

test('balance above floor -> no alert (arms the rule)', async () => {
  nextBalance = '10';
  const before = received.length;
  await pollAndDrain();
  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const alert = fresh.find((e) => e.type === 'alert.balance_low');
  assert.equal(alert, undefined, 'unexpected alert above floor');
});

test('balance drops below floor -> fires exactly one alert', async () => {
  nextBalance = '0.5';
  const before = received.length;
  await pollAndDrain();
  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const alerts = fresh.filter((e) => e.type === 'alert.balance_low');
  assert.equal(alerts.length, 1, `expected 1 alert, got ${alerts.length}`);
  assert.equal(alerts[0].data.ruleId, rule.id);
  assert.equal(alerts[0].data.floorRitual, '1');
  assert.equal(alerts[0].data.balanceRitual, '0.5');
  assert.equal(alerts[0].data.severity, 'warn');
});

test('balance still below floor on next poll -> NO re-fire (hysteresis)', async () => {
  nextBalance = '0.4';
  const before = received.length;
  await pollAndDrain();
  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const alerts = fresh.filter((e) => e.type === 'alert.balance_low');
  assert.equal(alerts.length, 0, 'rule re-fired while tripped');
});

test('balance recovers just above floor (within margin) -> still no re-arm, no fire', async () => {
  // ARM_MARGIN is 1.05 → must exceed 1.05 to re-arm. 1.02 is above floor but
  // within the margin → still considered tripped, no new alert.
  nextBalance = '1.02';
  const before = received.length;
  await pollAndDrain();
  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const alerts = fresh.filter((e) => e.type === 'alert.balance_low');
  assert.equal(alerts.length, 0, 'unexpected alert during hysteresis window');
});

test('balance recovers above floor * margin -> re-arms, no alert', async () => {
  nextBalance = '5';
  const before = received.length;
  await pollAndDrain();
  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const alerts = fresh.filter((e) => e.type === 'alert.balance_low');
  assert.equal(alerts.length, 0, 'unexpected alert during re-arm');
});

test('balance drops below floor again -> fires a SECOND alert', async () => {
  nextBalance = '0.1';
  const before = received.length;
  await pollAndDrain();
  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const alerts = fresh.filter((e) => e.type === 'alert.balance_low');
  assert.equal(alerts.length, 1, `expected second alert, got ${alerts.length}`);
  assert.equal(alerts[0].data.balanceRitual, '0.1');
});

test('disabled rule does not fire', async () => {
  await client.alerts.update(rule.id, { enabled: false });
  // Bring it back above margin to re-arm-IF the rule were active, then drop.
  nextBalance = '5';
  await pollAndDrain();
  nextBalance = '0.01';
  const before = received.length;
  await pollAndDrain();
  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const alerts = fresh.filter((e) => e.type === 'alert.balance_low');
  assert.equal(alerts.length, 0, 'disabled rule fired');
});

test('archived wallet is skipped by the poller', async () => {
  // Re-enable the rule, then archive the wallet via /export-key (which marks
  // it archived). After that the poller should ignore it even if balance < floor.
  await client.alerts.update(rule.id, { enabled: true });

  // Re-arm: balance way above floor
  nextBalance = '99';
  await pollAndDrain();

  // Archive via key export
  await client.wallets.exportKey({
    walletId: wallet.walletId,
    agentShard: wallet.agentShard,
  });

  // Drop balance — but wallet is archived, so poller's `w.status = 'active'`
  // filter excludes it.
  nextBalance = '0';
  const before = received.length;
  await pollAndDrain();
  const fresh = received.slice(before).map((h) => JSON.parse(h.body));
  const alerts = fresh.filter((e) => e.type === 'alert.balance_low');
  assert.equal(alerts.length, 0, 'archived wallet fired alert');
});
