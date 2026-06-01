/**
 * Centralized config loader with fail-fast validation.
 * All other modules should import config values from here rather than reading
 * process.env directly.
 */

const ZERO_KEY = '0'.repeat(64);

export interface AppConfig {
  port: number;
  databasePath: string;
  ritualRpcUrl: string;
  encryptionKey: string; // 32-byte hex, no 0x prefix
  apiKey: string | null;
  openMode: boolean;
  faucetPrivateKey: string | null; // 0x-prefixed
  faucetAmount: string; // RITUAL (decimal string)
  faucetDailyCap: string | null; // RITUAL (decimal string), null = no cap
}

function getEncryptionKey(): string {
  const raw = (process.env.ENCRYPTION_KEY || '').trim();
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Generate one with: ' +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  const normalized = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes hex (64 hex chars)');
  }
  if (normalized.toLowerCase() === ZERO_KEY) {
    throw new Error(
      'ENCRYPTION_KEY is all zeros — this is not a real key. Generate one with: ' +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return normalized;
}

function getAuthConfig(): { apiKey: string | null; openMode: boolean } {
  const openMode = process.env.OPEN_MODE === 'true';
  const apiKey = process.env.API_KEY || null;

  if (openMode && apiKey) {
    throw new Error(
      'Both OPEN_MODE=true and API_KEY are set — pick one. OPEN_MODE disables auth entirely.'
    );
  }
  if (!openMode && !apiKey) {
    throw new Error(
      'API_KEY is not set. Set API_KEY=<secret> for authenticated mode, or OPEN_MODE=true to explicitly run without auth (NOT recommended for shared servers).'
    );
  }
  return { apiKey, openMode };
}

function getFaucetConfig(): { privateKey: string | null; amount: string; dailyCap: string | null } {
  const raw = (process.env.FAUCET_PRIVATE_KEY || '').trim();
  const amount = (process.env.FAUCET_AMOUNT || '0.01').trim();
  const dailyCap = (process.env.FAUCET_DAILY_CAP || '').trim();

  if (!raw) return { privateKey: null, amount, dailyCap: dailyCap || null };

  const normalized = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(
      'FAUCET_PRIVATE_KEY must be a 32-byte hex private key (0x-prefixed, 64 hex chars)'
    );
  }
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error('FAUCET_AMOUNT must be a positive decimal number (e.g. "0.01")');
  }
  if (parseFloat(amount) <= 0) {
    throw new Error('FAUCET_AMOUNT must be > 0');
  }
  if (dailyCap && !/^\d+(\.\d+)?$/.test(dailyCap)) {
    throw new Error('FAUCET_DAILY_CAP must be a positive decimal number (e.g. "10.0")');
  }
  if (dailyCap && parseFloat(dailyCap) <= 0) {
    throw new Error('FAUCET_DAILY_CAP must be > 0');
  }
  return { privateKey: normalized, amount, dailyCap: dailyCap || null };
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;

  const auth = getAuthConfig();
  const faucet = getFaucetConfig();
  cached = {
    port: parseInt(process.env.PORT || '3000', 10),
    databasePath: process.env.DATABASE_PATH || './data/wallets.db',
    ritualRpcUrl:
      process.env.RITUAL_RPC_URL || 'https://rpc.ritualfoundation.org',
    encryptionKey: getEncryptionKey(),
    apiKey: auth.apiKey,
    openMode: auth.openMode,
    faucetPrivateKey: faucet.privateKey,
    faucetAmount: faucet.amount,
    faucetDailyCap: faucet.dailyCap,
  };
  return cached;
}

/** Test-only: reset cached config so env changes are re-read. */
export function _resetConfigCache(): void {
  cached = null;
}
