/**
 * Persistent bearer→user mapping for the per-visitor identity layer.
 *
 * Each row: a unique bearer (random hex) issued via /claim → the wallet-service
 * user that bearer represents (P-256 keypair). Stored in better-sqlite3 because
 * we already have it in the monorepo and it's perfect for low-write/high-read
 * key-value lookups.
 *
 * The store sits behind a small Claims interface so the http handler doesn't
 * touch SQL directly.
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

export interface ClaimedUser {
  bearer: string;
  userId: string;
  publicKey: string;
  privateKey: string;
  walletServiceUrl: string;
  createdAt: string;
}

export class ClaimStore {
  private readonly db: Database.Database;
  private readonly cache = new Map<string, ClaimedUser>();

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS claims (
        bearer TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        public_key TEXT NOT NULL,
        private_key TEXT NOT NULL,
        wallet_service_url TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_claims_user_id ON claims(user_id);
    `);
  }

  static newBearer(): string {
    return randomBytes(32).toString('hex');
  }

  insert(claim: Omit<ClaimedUser, 'createdAt'>): ClaimedUser {
    const row: ClaimedUser = { ...claim, createdAt: new Date().toISOString() };
    this.db
      .prepare(
        `INSERT INTO claims (bearer, user_id, public_key, private_key, wallet_service_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(row.bearer, row.userId, row.publicKey, row.privateKey, row.walletServiceUrl, row.createdAt);
    this.cache.set(row.bearer, row);
    return row;
  }

  /** Hot path — every MCP tool call hits this. Cache aggressively. */
  lookup(bearer: string): ClaimedUser | null {
    const cached = this.cache.get(bearer);
    if (cached) return cached;

    const row = this.db
      .prepare(
        `SELECT bearer, user_id as userId, public_key as publicKey, private_key as privateKey,
                wallet_service_url as walletServiceUrl, created_at as createdAt
         FROM claims WHERE bearer = ?`
      )
      .get(bearer) as ClaimedUser | undefined;

    if (row) this.cache.set(bearer, row);
    return row ?? null;
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as c FROM claims`).get() as { c: number };
    return row.c;
  }
}
