import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

import { _resetConfigCache } from '../src/core/config.js';
import { initDatabase, revertApiKeyGrant } from '../src/db/database.js';
import { createApp } from '../src/api/server.js';

const API_KEY = 'test-secret-token';
let tmpDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-test-'));
  process.env.ENCRYPTION_KEY = 'c'.repeat(64);
  process.env.API_KEY = API_KEY;
  delete process.env.OPEN_MODE;
  // The api.test.ts suite creates many wallets per run — opt out of the
  // 1-per-API-key sybil guard by clearing it between tests via direct DB
  // access. The dedicated sybil.test.ts file covers the guard itself.
  _resetConfigCache();

  initDatabase(path.join(tmpDir, 'test.db'));
  app = createApp();
});

afterAll(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

// The api.test.ts suite creates many wallets — release the api-key-hash grant
// before each test so the 1-per-key Sybil guard doesn't reject our follow-up
// creates. Dedicated coverage for that guard lives in sybil.test.ts.
const API_KEY_HASH = createHash('sha256').update(API_KEY).digest('hex');
beforeEach(() => {
  revertApiKeyGrant(API_KEY_HASH);
});

const auth = (h: any) => h.set('Authorization', `Bearer ${API_KEY}`);

describe('GET /health', () => {
  it('returns ok without auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Auth enforcement', () => {
  it('rejects /wallets without bearer token', async () => {
    const res = await request(app).get('/wallets');
    expect(res.status).toBe(401);
  });

  it('rejects /wallets with wrong bearer token', async () => {
    const res = await request(app)
      .get('/wallets')
      .set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(403);
  });

  it('accepts /wallets with correct token', async () => {
    const res = await auth(request(app).get('/wallets'));
    expect(res.status).toBe(200);
  });
});

describe('POST /wallets', () => {
  it('creates a wallet, returns address + agentShard once', async () => {
    const res = await auth(request(app).post('/wallets')).send({ label: 'agent-1' });
    expect(res.status).toBe(201);
    expect(res.body.walletId).toBeTruthy();
    expect(res.body.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(res.body.agentShard).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.label).toBe('agent-1');
  });

  it('appears in /wallets list', async () => {
    await auth(request(app).post('/wallets')).send({ label: 'lister-test' });
    const res = await auth(request(app).get('/wallets'));
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.wallets.some((w: any) => w.label === 'lister-test')).toBe(true);
  });

  it('response includes auto-bootstrap hint pointing at ritual-bootstrap prompt', async () => {
    const res = await auth(request(app).post('/wallets')).send({ label: 'bootstrap-hint' });
    expect(res.status).toBe(201);
    expect(res.body.next).toBeTruthy();
    expect(res.body.next.mcpPrompt).toBe('ritual-bootstrap');
    expect(res.body.next.mcpTools.map((t: any) => t.name)).toEqual(
      expect.arrayContaining(['read_ritual_rules', 'list_ritual_skills', 'fund_wallet'])
    );
    expect(res.body.next.restEndpoints[0].path).toContain(res.body.walletId);
  });
});

describe('GET /wallets/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await auth(request(app).get('/wallets/does-not-exist'));
    expect(res.status).toBe(404);
  });

  it('returns wallet details for known id', async () => {
    const created = await auth(request(app).post('/wallets')).send({ label: 'lookup' });
    const res = await auth(request(app).get(`/wallets/${created.body.walletId}`));
    expect(res.status).toBe(200);
    expect(res.body.address).toBe(created.body.address);
    expect(res.body).not.toHaveProperty('serverShard'); // never leak the server shard
  });
});

describe('PATCH /wallets/:id/policy + freeze flow', () => {
  it('updates policy and reflects it back', async () => {
    const created = await auth(request(app).post('/wallets')).send({ label: 'policy' });
    const id = created.body.walletId;

    const update = await auth(request(app).patch(`/wallets/${id}/policy`)).send({
      maxPerTransaction: '0.25',
      maxTxPerMinute: 3,
    });
    expect(update.status).toBe(200);
    expect(update.body.policy.maxPerTransaction).toBe('0.25');
    expect(update.body.policy.maxTxPerMinute).toBe(3);
  });

  it('freezes and unfreezes a wallet', async () => {
    const created = await auth(request(app).post('/wallets')).send({});
    const id = created.body.walletId;

    let res = await auth(request(app).post(`/wallets/${id}/freeze`));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('frozen');

    res = await auth(request(app).post(`/wallets/${id}/unfreeze`));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });
});

describe('POST /wallets/:id/send (validation)', () => {
  it('rejects an invalid destination address', async () => {
    const created = await auth(request(app).post('/wallets')).send({});
    const res = await auth(request(app).post(`/wallets/${created.body.walletId}/send`)).send({
      agentShard: created.body.agentShard,
      to: 'not-an-address',
      value: '0.1',
    });
    expect(res.status).toBe(400);
  });

  it('rejects when frozen', async () => {
    const created = await auth(request(app).post('/wallets')).send({});
    const id = created.body.walletId;
    await auth(request(app).post(`/wallets/${id}/freeze`));

    const res = await auth(request(app).post(`/wallets/${id}/send`)).send({
      agentShard: created.body.agentShard,
      to: '0x000000000000000000000000000000000000dEaD',
      value: '0.1',
    });
    expect(res.status).toBe(403);
  });
});
