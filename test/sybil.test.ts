import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { _resetConfigCache } from '../src/core/config.js';
import {
  initDatabase,
  claimApiKeyGrant,
  getApiKeyGrant,
  revertApiKeyGrant,
  createWallet,
} from '../src/db/database.js';
import { createApp } from '../src/api/server.js';

const API_KEY_A = 'sybil-test-key-aaaa';
const API_KEY_B = 'sybil-test-key-bbbb';
let tmpDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-sybil-'));
  process.env.ENCRYPTION_KEY = 'e'.repeat(64);
  process.env.API_KEY = API_KEY_A; // server only validates this one
  delete process.env.OPEN_MODE;
  delete process.env.FAUCET_PRIVATE_KEY;
  _resetConfigCache();

  initDatabase(path.join(tmpDir, 'sybil.db'));
  app = createApp();
});

afterAll(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

const auth = (h: any, key: string = API_KEY_A) =>
  h.set('Authorization', `Bearer ${key}`);

describe('claimApiKeyGrant (DB-level atomicity)', () => {
  it('first call wins, second returns false (UNIQUE constraint)', () => {
    const wallet1 = createWallet(`0x${'5'.repeat(40)}`, `0x04${'5'.repeat(128)}`, 'enc', 'g1');
    const wallet2 = createWallet(`0x${'6'.repeat(40)}`, `0x04${'6'.repeat(128)}`, 'enc', 'g2');

    const a = claimApiKeyGrant('hash-a', wallet1.id);
    const b = claimApiKeyGrant('hash-a', wallet2.id);
    expect(a).toBe(true);
    expect(b).toBe(false);

    const grant = getApiKeyGrant('hash-a');
    expect(grant?.walletId).toBe(wallet1.id);
  });

  it('different hashes can each claim their own wallet', () => {
    const wallet1 = createWallet(`0x${'7'.repeat(40)}`, `0x04${'7'.repeat(128)}`, 'enc', 'h1');
    const wallet2 = createWallet(`0x${'8'.repeat(40)}`, `0x04${'8'.repeat(128)}`, 'enc', 'h2');

    expect(claimApiKeyGrant('hash-x', wallet1.id)).toBe(true);
    expect(claimApiKeyGrant('hash-y', wallet2.id)).toBe(true);
    expect(getApiKeyGrant('hash-x')?.walletId).toBe(wallet1.id);
    expect(getApiKeyGrant('hash-y')?.walletId).toBe(wallet2.id);
  });

  it('revert allows re-claim with the same hash', () => {
    const wallet = createWallet(`0x${'9'.repeat(40)}`, `0x04${'9'.repeat(128)}`, 'enc', 'r');
    expect(claimApiKeyGrant('hash-r', wallet.id)).toBe(true);
    revertApiKeyGrant('hash-r');
    expect(getApiKeyGrant('hash-r')).toBeUndefined();
    const wallet2 = createWallet(`0x${'a'.repeat(40)}`, `0x04${'a'.repeat(128)}`, 'enc', 'r2');
    expect(claimApiKeyGrant('hash-r', wallet2.id)).toBe(true);
  });
});

describe('POST /wallets — 1 wallet per API key', () => {
  it('first call succeeds, second returns 409 with code=api_key_already_bound', async () => {
    const first = await auth(request(app).post('/wallets')).send({ label: 'first' });
    expect(first.status).toBe(201);
    expect(first.body.walletId).toBeTruthy();

    const second = await auth(request(app).post('/wallets')).send({ label: 'second' });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('api_key_already_bound');
    expect(second.body.walletId).toBe(first.body.walletId);
  });

  it('GET /wallets/me returns the bound wallet', async () => {
    // Use the same valid API_KEY (server only knows one); the prior test already
    // bound it, so /wallets/me should return the wallet from `first`.
    const me = await auth(request(app).get('/wallets/me'));
    expect(me.status).toBe(200);
    expect(me.body.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('GET /wallets/me with wrong key is rejected before lookup', async () => {
    const res = await auth(request(app).get('/wallets/me'), 'wrong-key');
    expect(res.status).toBe(403);
  });
});
