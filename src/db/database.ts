import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { DEFAULT_POLICY, type WalletPolicy } from '../core/policy.js';

// ============================================================
// Types
// ============================================================

export interface WalletRecord {
  id: string;
  address: string;
  publicKey: string;
  serverShard: string; // encrypted at rest
  label: string;
  status: 'active' | 'frozen' | 'archived';
  createdAt: string;
  fundedAt: string | null;
}

export interface TransactionRecord {
  id: string;
  walletId: string;
  hash: string;
  toAddress: string;
  value: string;
  data: string;
  status: 'pending' | 'confirmed' | 'failed';
  createdAt: string;
}

export interface AuditRecord {
  id: string;
  walletId: string;
  action: string;
  details: string;
  timestamp: string;
}

// ============================================================
// Database Singleton
// ============================================================

let db: Database.Database;

/**
 * Initialize the SQLite database with all required tables.
 */
export function initDatabase(dbPath: string): Database.Database {
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read access
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      server_shard TEXT NOT NULL,
      label TEXT DEFAULT '',
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'frozen', 'archived')),
      created_at TEXT DEFAULT (datetime('now')),
      funded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS policies (
      wallet_id TEXT PRIMARY KEY REFERENCES wallets(id) ON DELETE CASCADE,
      max_per_transaction TEXT DEFAULT '1.0',
      max_daily_spend TEXT DEFAULT '5.0',
      allowed_addresses TEXT DEFAULT '[]',
      max_tx_per_minute INTEGER DEFAULT 10,
      frozen INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      hash TEXT,
      to_address TEXT NOT NULL,
      value TEXT NOT NULL,
      data TEXT DEFAULT '0x',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'failed')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      details TEXT DEFAULT '',
      timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_wallet ON audit_log(wallet_id);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);

    CREATE TABLE IF NOT EXISTS api_key_grants (
      api_key_hash TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL UNIQUE REFERENCES wallets(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migration: add funded_at to existing databases that pre-date the column
  const columns = db.prepare("PRAGMA table_info(wallets)").all() as { name: string }[];
  if (!columns.some((c) => c.name === 'funded_at')) {
    db.exec("ALTER TABLE wallets ADD COLUMN funded_at TEXT");
  }

  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// ============================================================
// Wallet Operations
// ============================================================

export function createWallet(
  address: string,
  publicKey: string,
  serverShard: string,
  label: string = ''
): WalletRecord {
  const id = randomUUID();

  getDb()
    .prepare(
      `INSERT INTO wallets (id, address, public_key, server_shard, label)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, address, publicKey, serverShard, label);

  // Create default policy
  getDb()
    .prepare(
      `INSERT INTO policies (wallet_id, max_per_transaction, max_daily_spend, allowed_addresses, max_tx_per_minute, frozen)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      DEFAULT_POLICY.maxPerTransaction,
      DEFAULT_POLICY.maxDailySpend,
      JSON.stringify(DEFAULT_POLICY.allowedAddresses),
      DEFAULT_POLICY.maxTxPerMinute,
      DEFAULT_POLICY.frozen ? 1 : 0
    );

  logAudit(id, 'wallet_created', `Address: ${address}`);

  return {
    id,
    address,
    publicKey,
    serverShard,
    label,
    status: 'active',
    createdAt: new Date().toISOString(),
    fundedAt: null,
  };
}

export function getWallet(id: string): WalletRecord | undefined {
  const row = getDb()
    .prepare('SELECT * FROM wallets WHERE id = ?')
    .get(id) as any;
  if (!row) return undefined;
  return mapWalletRow(row);
}

export function getWalletByAddress(address: string): WalletRecord | undefined {
  const row = getDb()
    .prepare('SELECT * FROM wallets WHERE LOWER(address) = LOWER(?)')
    .get(address) as any;
  if (!row) return undefined;
  return mapWalletRow(row);
}

export function listWallets(): WalletRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM wallets ORDER BY created_at DESC')
    .all() as any[];
  return rows.map(mapWalletRow);
}

export function updateWalletStatus(
  id: string,
  status: 'active' | 'frozen' | 'archived'
): void {
  getDb().prepare('UPDATE wallets SET status = ? WHERE id = ?').run(status, id);
  logAudit(id, 'status_changed', `New status: ${status}`);
}

function mapWalletRow(row: any): WalletRecord {
  return {
    id: row.id,
    address: row.address,
    publicKey: row.public_key,
    serverShard: row.server_shard,
    label: row.label,
    status: row.status,
    createdAt: row.created_at,
    fundedAt: row.funded_at ?? null,
  };
}

/**
 * Atomically claim faucet funding for a wallet. Returns true if this caller
 * won the claim (caller should now send tokens), false if already funded.
 * Use revertFundingClaim() to undo if the send fails.
 */
export function claimFundingSlot(walletId: string): boolean {
  const result = getDb()
    .prepare(
      "UPDATE wallets SET funded_at = datetime('now') WHERE id = ? AND funded_at IS NULL"
    )
    .run(walletId);
  if (result.changes === 1) {
    logAudit(walletId, 'faucet_claim_reserved', '');
    return true;
  }
  return false;
}

/** Roll back a claim if the on-chain send failed. */
export function revertFundingClaim(walletId: string): void {
  getDb()
    .prepare('UPDATE wallets SET funded_at = NULL WHERE id = ?')
    .run(walletId);
  logAudit(walletId, 'faucet_claim_reverted', '');
}

// ============================================================
// Policy Operations
// ============================================================

export function getPolicy(walletId: string): WalletPolicy {
  const row = getDb()
    .prepare('SELECT * FROM policies WHERE wallet_id = ?')
    .get(walletId) as any;
  if (!row) return { ...DEFAULT_POLICY };
  return {
    maxPerTransaction: row.max_per_transaction,
    maxDailySpend: row.max_daily_spend,
    allowedAddresses: JSON.parse(row.allowed_addresses),
    maxTxPerMinute: row.max_tx_per_minute,
    frozen: row.frozen === 1,
  };
}

export function updatePolicy(
  walletId: string,
  policy: Partial<WalletPolicy>
): void {
  const current = getPolicy(walletId);
  const merged = { ...current, ...policy };
  getDb()
    .prepare(
      `UPDATE policies SET
        max_per_transaction = ?,
        max_daily_spend = ?,
        allowed_addresses = ?,
        max_tx_per_minute = ?,
        frozen = ?
      WHERE wallet_id = ?`
    )
    .run(
      merged.maxPerTransaction,
      merged.maxDailySpend,
      JSON.stringify(merged.allowedAddresses),
      merged.maxTxPerMinute,
      merged.frozen ? 1 : 0,
      walletId
    );
  logAudit(walletId, 'policy_updated', JSON.stringify(policy));
}

// ============================================================
// Transaction Operations
// ============================================================

export function recordTransaction(
  walletId: string,
  hash: string,
  toAddress: string,
  value: string,
  data: string = '0x',
  status: 'pending' | 'confirmed' | 'failed' = 'pending'
): TransactionRecord {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO transactions (id, wallet_id, hash, to_address, value, data, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, walletId, hash, toAddress, value, data, status);

  logAudit(
    walletId,
    'transaction_sent',
    `Hash: ${hash}, To: ${toAddress}, Value: ${value}`
  );

  return {
    id,
    walletId,
    hash,
    toAddress,
    value,
    data,
    status,
    createdAt: new Date().toISOString(),
  };
}

export function getTransactions(
  walletId: string,
  limit: number = 50
): TransactionRecord[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM transactions WHERE wallet_id = ? ORDER BY created_at DESC LIMIT ?'
    )
    .all(walletId, limit) as any[];
  return rows.map((row) => ({
    id: row.id,
    walletId: row.wallet_id,
    hash: row.hash,
    toAddress: row.to_address,
    value: row.value,
    data: row.data,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export function updateTransactionStatus(
  id: string,
  status: 'pending' | 'confirmed' | 'failed'
): void {
  getDb()
    .prepare('UPDATE transactions SET status = ? WHERE id = ?')
    .run(status, id);
}

/** Get recent transactions for policy checks (last 24h) */
export function getRecentTransactions(
  walletId: string
): { walletId: string; value: string; timestamp: number }[] {
  const rows = getDb()
    .prepare(
      `SELECT wallet_id, value, created_at FROM transactions
       WHERE wallet_id = ? AND created_at >= datetime('now', '-1 day')
       ORDER BY created_at DESC`
    )
    .all(walletId) as any[];
  return rows.map((row) => ({
    walletId: row.wallet_id,
    value: row.value,
    timestamp: new Date(row.created_at).getTime(),
  }));
}

// ============================================================
// Audit Log
// ============================================================

export function logAudit(
  walletId: string,
  action: string,
  details: string = ''
): void {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO audit_log (id, wallet_id, action, details)
       VALUES (?, ?, ?, ?)`
    )
    .run(id, walletId, action, details);
}

export function getAuditLog(
  walletId: string,
  limit: number = 100
): AuditRecord[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM audit_log WHERE wallet_id = ? ORDER BY timestamp DESC LIMIT ?'
    )
    .all(walletId, limit) as any[];
  return rows.map((row) => ({
    id: row.id,
    walletId: row.wallet_id,
    action: row.action,
    details: row.details,
    timestamp: row.timestamp,
  }));
}

/** Get summary stats across all wallets */
export function getStats(): {
  totalWallets: number;
  activeWallets: number;
  totalTransactions: number;
  recentTransactions: number;
} {
  const total = (
    getDb().prepare('SELECT COUNT(*) as count FROM wallets').get() as any
  ).count;
  const active = (
    getDb()
      .prepare("SELECT COUNT(*) as count FROM wallets WHERE status = 'active'")
      .get() as any
  ).count;
  const totalTx = (
    getDb().prepare('SELECT COUNT(*) as count FROM transactions').get() as any
  ).count;
  const recentTx = (
    getDb()
      .prepare(
        "SELECT COUNT(*) as count FROM transactions WHERE created_at >= datetime('now', '-1 day')"
      )
      .get() as any
  ).count;
  return {
    totalWallets: total,
    activeWallets: active,
    totalTransactions: totalTx,
    recentTransactions: recentTx,
  };
}

// ============================================================
// API Key Grants (1 wallet per API-key hash, atomic)
// ============================================================

/**
 * Atomically bind an API-key hash to a wallet ID. Returns true if this caller
 * was the first; false if the api-key has already created a wallet.
 *
 * The api_key_grants.api_key_hash PRIMARY KEY enforces uniqueness — two
 * concurrent INSERTs cannot both succeed.
 */
export function claimApiKeyGrant(apiKeyHash: string, walletId: string): boolean {
  try {
    getDb()
      .prepare(
        'INSERT INTO api_key_grants (api_key_hash, wallet_id) VALUES (?, ?)'
      )
      .run(apiKeyHash, walletId);
    return true;
  } catch (err: any) {
    if (
      err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
      err?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      /UNIQUE/.test(err?.message ?? '')
    ) {
      return false;
    }
    throw err;
  }
}

/** Look up the wallet bound to a given API-key hash, if any. */
export function getApiKeyGrant(apiKeyHash: string): { walletId: string; createdAt: string } | undefined {
  const row = getDb()
    .prepare(
      'SELECT wallet_id, created_at FROM api_key_grants WHERE api_key_hash = ?'
    )
    .get(apiKeyHash) as { wallet_id: string; created_at: string } | undefined;
  if (!row) return undefined;
  return { walletId: row.wallet_id, createdAt: row.created_at };
}

/**
 * Release an API-key grant — used when wallet creation fails after the grant
 * was inserted, so the API key can retry. The wallet itself is also deleted
 * by cascade if removed by the caller, but here we only remove the grant.
 */
export function revertApiKeyGrant(apiKeyHash: string): void {
  getDb()
    .prepare('DELETE FROM api_key_grants WHERE api_key_hash = ?')
    .run(apiKeyHash);
}
