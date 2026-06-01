import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { DEFAULT_POLICY, type WalletPolicy } from '@ritkey/core';
import { initUserTables } from './users.js';

// ============================================================
// Types
// ============================================================

export interface WalletRecord {
  id: string;
  address: string;
  publicKey: string;
  serverShard: string; // encrypted at rest
  backupShard: string | null; // encrypted backup shard (for 2-of-3)
  walletType: 'xor' | 'threshold'; // wallet type for migration support
  threshold: number | null; // minimum shares needed (2 for threshold, null for xor)
  totalShares: number | null; // total shares (3 for threshold, null for xor)
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

  // Initialize user tables
  initUserTables(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      server_shard TEXT NOT NULL,
      backup_shard TEXT,
      wallet_type TEXT DEFAULT 'xor' CHECK(wallet_type IN ('xor', 'threshold')),
      threshold INTEGER,
      total_shares INTEGER,
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

    CREATE TABLE IF NOT EXISTS faucet_claims (
      id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      amount TEXT NOT NULL,
      claimed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_faucet_claims_date ON faucet_claims(claimed_at);

    -- ============================================================
    -- Events: every notable wallet activity becomes an event
    -- ============================================================
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      wallet_id TEXT,
      payload TEXT NOT NULL,         -- JSON-serialized full event
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_wallet ON events(wallet_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

    -- ============================================================
    -- Webhook subscriptions: who wants to be notified about what
    -- ============================================================
    CREATE TABLE IF NOT EXISTS webhook_subscriptions (
      id TEXT PRIMARY KEY,
      api_key_hash TEXT NOT NULL,    -- Owner (sha256 of API key)
      url TEXT NOT NULL,             -- HTTPS endpoint to POST to
      secret TEXT NOT NULL,          -- HMAC signing secret
      events_filter TEXT NOT NULL,   -- JSON array of event types (or ['*'])
      label TEXT DEFAULT '',         -- User-friendly name
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'disabled')),
      created_at TEXT DEFAULT (datetime('now')),
      last_delivery_at TEXT,
      consecutive_failures INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_webhook_subs_owner ON webhook_subscriptions(api_key_hash);
    CREATE INDEX IF NOT EXISTS idx_webhook_subs_status ON webhook_subscriptions(status);

    -- ============================================================
    -- Webhook delivery queue: async delivery with retries
    -- ============================================================
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL,
      url TEXT NOT NULL,                            -- Snapshot of URL at delivery time
      payload TEXT NOT NULL,                        -- JSON event payload
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'delivered', 'failed', 'dead')),
      attempts INTEGER DEFAULT 0,
      next_attempt_at TEXT DEFAULT (datetime('now')),
      last_attempt_at TEXT,
      last_error TEXT,
      response_status INTEGER,
      response_body TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_deliveries_status_next ON webhook_deliveries(status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_deliveries_subscription ON webhook_deliveries(subscription_id);
    CREATE INDEX IF NOT EXISTS idx_deliveries_event ON webhook_deliveries(event_id);

    -- ============================================================
    -- Alert rules: per-wallet rules that map low-level events to alert.* events
    -- ============================================================
    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      api_key_hash TEXT NOT NULL,                                 -- owner
      wallet_id TEXT REFERENCES wallets(id) ON DELETE CASCADE,    -- NULL = applies to all owner's wallets
      kind TEXT NOT NULL CHECK(kind IN ('spend_threshold','unusual_recipient','key_export_warning','balance_low')),
      config TEXT NOT NULL,                                       -- JSON, kind-specific
      enabled INTEGER DEFAULT 1,
      severity TEXT DEFAULT 'warn' CHECK(severity IN ('info','warn','critical')),
      label TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_alert_rules_wallet ON alert_rules(wallet_id);
    CREATE INDEX IF NOT EXISTS idx_alert_rules_owner ON alert_rules(api_key_hash);
    CREATE INDEX IF NOT EXISTS idx_alert_rules_kind ON alert_rules(kind);

    -- ============================================================
    -- Alert rule state: hysteresis for poll-driven rules (balance_low).
    -- One row per (rule_id, wallet_id) once the rule has been evaluated
    -- at least once. 'armed' = balance currently above floor (or unknown);
    -- 'tripped' = below floor and an alert was already emitted, suppress
    -- further alerts until balance recovers above floor * margin.
    -- ============================================================
    -- ============================================================
    -- Indexer state: cursor for the chain indexer (tx.received).
    -- One row per indexer name; survives restarts so we don't replay history.
    -- ============================================================
    CREATE TABLE IF NOT EXISTS indexer_state (
      name TEXT PRIMARY KEY,
      last_block_number TEXT NOT NULL,
      last_checked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS alert_rule_state (
      rule_id TEXT NOT NULL,
      wallet_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('armed','tripped')),
      last_balance_ritual TEXT,
      last_checked_at TEXT,
      last_fired_at TEXT,
      PRIMARY KEY (rule_id, wallet_id),
      FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE,
      FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
    );
  `);

  // Migrations.
  //
  // M5: wrap multi-statement ALTERs in a transaction so a crash mid-migration
  // can't leave the schema half-migrated. We gate each transaction on the
  // *last* column being added to detect partial-then-skipped state.
  const columns = db.prepare("PRAGMA table_info(wallets)").all() as { name: string }[];

  if (!columns.some((c) => c.name === 'funded_at')) {
    db.exec('BEGIN');
    try {
      db.exec("ALTER TABLE wallets ADD COLUMN funded_at TEXT");
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  // Gate on `total_shares` (the last added column) so a partial migration
  // is detected and retried.
  if (!columns.some((c) => c.name === 'total_shares')) {
    db.exec('BEGIN');
    try {
      // Use IF NOT EXISTS-style guards by re-querying inside the txn.
      const cur = new Set(
        (db.prepare("PRAGMA table_info(wallets)").all() as { name: string }[]).map((c) => c.name)
      );
      if (!cur.has('backup_shard')) db.exec('ALTER TABLE wallets ADD COLUMN backup_shard TEXT');
      if (!cur.has('wallet_type')) {
        db.exec(
          "ALTER TABLE wallets ADD COLUMN wallet_type TEXT DEFAULT 'xor' CHECK(wallet_type IN ('xor', 'threshold'))"
        );
      }
      if (!cur.has('threshold')) db.exec('ALTER TABLE wallets ADD COLUMN threshold INTEGER');
      if (!cur.has('total_shares')) db.exec('ALTER TABLE wallets ADD COLUMN total_shares INTEGER');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
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
  label: string = '',
  backupShard: string | null = null,
  walletType: 'xor' | 'threshold' = 'xor',
  threshold: number | null = null,
  totalShares: number | null = null
): WalletRecord {
  const id = randomUUID();

  getDb()
    .prepare(
      `INSERT INTO wallets (id, address, public_key, server_shard, backup_shard, wallet_type, threshold, total_shares, label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, address, publicKey, serverShard, backupShard, walletType, threshold, totalShares, label);

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

  logAudit(id, 'wallet_created', `Address: ${address}, Type: ${walletType}`);

  return {
    id,
    address,
    publicKey,
    serverShard,
    backupShard,
    walletType,
    threshold,
    totalShares,
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
    backupShard: row.backup_shard ?? null,
    walletType: row.wallet_type ?? 'xor',
    threshold: row.threshold ?? null,
    totalShares: row.total_shares ?? null,
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

// ============================================================
// Faucet Claims Tracking
// ============================================================

/**
 * Record a successful faucet claim for daily cap tracking.
 */
export function recordFaucetClaim(walletId: string, amount: string): void {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO faucet_claims (id, wallet_id, amount)
       VALUES (?, ?, ?)`
    )
    .run(id, walletId, amount);
}

/**
 * Get total faucet claims for today (UTC day boundary).
 * Returns the sum in RITUAL as a decimal string.
 */
export function getTodayFaucetTotal(): string {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as total
       FROM faucet_claims
       WHERE DATE(claimed_at) = DATE('now')`
    )
    .get() as { total: number };
  return row.total.toString();
}

/**
 * M1 (TOCTOU fix): atomically check the daily cap and claim the per-wallet
 * funding slot in one SQLite transaction. Returns:
 *   - { ok: true } if the caller may proceed to send tokens
 *   - { ok: false, reason: 'cap_exceeded' | 'already_funded' } if rejected
 *
 * On 'cap_exceeded' or downstream failures the caller must call
 * revertFundingClaim() to free the slot.
 */
export function tryClaimFaucetSlot(
  walletId: string,
  requestAmountRitual: string,
  dailyCapRitual: string | null
): { ok: true } | { ok: false; reason: 'cap_exceeded' | 'already_funded'; todayTotal?: string } {
  const tx = getDb().transaction(() => {
    if (dailyCapRitual) {
      const todayRow = getDb().prepare(
        `SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as total
         FROM faucet_claims
         WHERE DATE(claimed_at) = DATE('now')`
      ).get() as { total: number };
      const reqAmount = parseFloat(requestAmountRitual);
      const cap = parseFloat(dailyCapRitual);
      if (todayRow.total + reqAmount > cap) {
        return { ok: false as const, reason: 'cap_exceeded' as const, todayTotal: todayRow.total.toString() };
      }
    }

    const claim = getDb().prepare(
      "UPDATE wallets SET funded_at = datetime('now') WHERE id = ? AND funded_at IS NULL"
    ).run(walletId);

    if (claim.changes !== 1) {
      return { ok: false as const, reason: 'already_funded' as const };
    }

    return { ok: true as const };
  });

  return tx();
}
