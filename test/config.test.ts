import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _resetConfigCache, loadConfig } from '../src/core/config.js';

describe('config.loadConfig', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    _resetConfigCache();
    delete process.env.ENCRYPTION_KEY;
    delete process.env.API_KEY;
    delete process.env.OPEN_MODE;
    delete process.env.FAUCET_PRIVATE_KEY;
    delete process.env.FAUCET_AMOUNT;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    _resetConfigCache();
  });

  it('throws when ENCRYPTION_KEY is missing', () => {
    process.env.API_KEY = 'test';
    expect(() => loadConfig()).toThrow(/ENCRYPTION_KEY is not set/);
  });

  it('throws when ENCRYPTION_KEY is all zeros', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    process.env.API_KEY = 'test';
    expect(() => loadConfig()).toThrow(/all zeros/);
  });

  it('throws when ENCRYPTION_KEY is malformed', () => {
    process.env.ENCRYPTION_KEY = 'not-hex';
    process.env.API_KEY = 'test';
    expect(() => loadConfig()).toThrow(/32 bytes hex/);
  });

  it('throws when neither API_KEY nor OPEN_MODE is set', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    expect(() => loadConfig()).toThrow(/API_KEY is not set/);
  });

  it('throws when both API_KEY and OPEN_MODE are set', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.API_KEY = 'test';
    process.env.OPEN_MODE = 'true';
    expect(() => loadConfig()).toThrow(/pick one/);
  });

  it('strips 0x prefix from ENCRYPTION_KEY', () => {
    process.env.ENCRYPTION_KEY = '0x' + 'a'.repeat(64);
    process.env.API_KEY = 'test';
    const config = loadConfig();
    expect(config.encryptionKey).toBe('a'.repeat(64));
    expect(config.encryptionKey).toHaveLength(64);
  });

  it('loads valid auth + encryption config', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.API_KEY = 'secret-token';
    const config = loadConfig();
    expect(config.apiKey).toBe('secret-token');
    expect(config.openMode).toBe(false);
  });

  it('allows OPEN_MODE without API_KEY', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.OPEN_MODE = 'true';
    const config = loadConfig();
    expect(config.openMode).toBe(true);
    expect(config.apiKey).toBeNull();
  });

  it('rejects malformed FAUCET_PRIVATE_KEY', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.API_KEY = 'test';
    process.env.FAUCET_PRIVATE_KEY = 'not-a-hex-key';
    expect(() => loadConfig()).toThrow(/FAUCET_PRIVATE_KEY/);
  });

  it('rejects negative FAUCET_AMOUNT', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.API_KEY = 'test';
    process.env.FAUCET_PRIVATE_KEY = '0x' + 'a'.repeat(64);
    process.env.FAUCET_AMOUNT = '-1';
    expect(() => loadConfig()).toThrow(/FAUCET_AMOUNT/);
  });

  it('defaults FAUCET_AMOUNT to 0.01 when faucet is enabled without explicit amount', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.API_KEY = 'test';
    process.env.FAUCET_PRIVATE_KEY = '0x' + 'a'.repeat(64);
    delete process.env.FAUCET_AMOUNT;
    const config = loadConfig();
    expect(config.faucetAmount).toBe('0.01');
    expect(config.faucetPrivateKey).toBe('0x' + 'a'.repeat(64));
  });

  it('disables faucet when FAUCET_PRIVATE_KEY is unset', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.API_KEY = 'test';
    delete process.env.FAUCET_PRIVATE_KEY;
    const config = loadConfig();
    expect(config.faucetPrivateKey).toBeNull();
  });
});
