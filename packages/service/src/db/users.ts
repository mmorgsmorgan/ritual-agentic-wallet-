import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

/**
 * User/Agent Management
 *
 * Users can be:
 * - Human operators (with admin permissions)
 * - AI agents (with limited permissions)
 */

export type UserType = 'human' | 'agent';

export type Permission =
  | 'wallet:create'
  | 'wallet:read'
  | 'wallet:send'
  | 'wallet:sign'
  | 'wallet:fund'
  | 'wallet:freeze'
  | 'wallet:archive'
  | 'admin:users'
  | 'admin:policies';

export interface UserRecord {
  id: string;
  userName: string;
  userType: UserType;
  status: 'active' | 'suspended';
  createdAt: string;
}

export interface ApiKeyRecord {
  id: string;
  userId: string;
  keyName: string;
  publicKey: string; // Compressed P-256 public key
  curveType: 'P256';
  status: 'active' | 'revoked';
  createdAt: string;
  lastUsedAt: string | null;
}

export interface UserPermission {
  userId: string;
  permission: Permission;
}

/**
 * Initialize user/agent management tables
 */
export function initUserTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      user_name TEXT NOT NULL UNIQUE,
      user_type TEXT NOT NULL CHECK(user_type IN ('human', 'agent')),
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_name TEXT NOT NULL,
      public_key TEXT NOT NULL UNIQUE,
      curve_type TEXT DEFAULT 'P256',
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
      created_at TEXT DEFAULT (datetime('now')),
      last_used_at TEXT,
      UNIQUE(user_id, key_name)
    );

    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      PRIMARY KEY (user_id, permission)
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_public ON api_keys(public_key);
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
  `);
}

/**
 * Create a new user (human or agent)
 */
export function createUser(
  db: Database.Database,
  userName: string,
  userType: UserType,
  apiKeys: Array<{ keyName: string; publicKey: string }>,
  permissions: Permission[]
): UserRecord {
  const userId = randomUUID();

  const tx = db.transaction(() => {
    // Create user
    db.prepare(
      'INSERT INTO users (id, user_name, user_type) VALUES (?, ?, ?)'
    ).run(userId, userName, userType);

    // Add API keys
    for (const key of apiKeys) {
      const keyId = randomUUID();
      db.prepare(
        'INSERT INTO api_keys (id, user_id, key_name, public_key) VALUES (?, ?, ?, ?)'
      ).run(keyId, userId, key.keyName, key.publicKey);
    }

    // Add permissions
    for (const permission of permissions) {
      db.prepare(
        'INSERT INTO user_permissions (user_id, permission) VALUES (?, ?)'
      ).run(userId, permission);
    }
  });

  tx();

  return {
    id: userId,
    userName,
    userType,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Get user by API key public key
 */
export function getUserByApiKey(
  db: Database.Database,
  publicKey: string
): (UserRecord & { apiKeyId: string }) | undefined {
  const row = db.prepare(`
    SELECT u.*, k.id as api_key_id
    FROM users u
    JOIN api_keys k ON k.user_id = u.id
    WHERE k.public_key = ? AND k.status = 'active' AND u.status = 'active'
  `).get(publicKey) as any;

  if (!row) return undefined;

  return {
    id: row.id,
    userName: row.user_name,
    userType: row.user_type,
    status: row.status,
    createdAt: row.created_at,
    apiKeyId: row.api_key_id,
  };
}

/**
 * Check if user has permission
 */
export function hasPermission(
  db: Database.Database,
  userId: string,
  permission: Permission
): boolean {
  const row = db.prepare(
    'SELECT 1 FROM user_permissions WHERE user_id = ? AND permission = ?'
  ).get(userId, permission);

  return !!row;
}

/**
 * Get all permissions for a user
 */
export function getUserPermissions(
  db: Database.Database,
  userId: string
): Permission[] {
  const rows = db.prepare(
    'SELECT permission FROM user_permissions WHERE user_id = ?'
  ).all(userId) as Array<{ permission: Permission }>;

  return rows.map(r => r.permission);
}

/**
 * Update API key last used timestamp
 */
export function updateApiKeyLastUsed(
  db: Database.Database,
  apiKeyId: string
): void {
  db.prepare(
    "UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?"
  ).run(apiKeyId);
}

/**
 * List all users
 */
export function listUsers(db: Database.Database): UserRecord[] {
  const rows = db.prepare(
    'SELECT * FROM users ORDER BY created_at DESC'
  ).all() as any[];

  return rows.map(row => ({
    id: row.id,
    userName: row.user_name,
    userType: row.user_type,
    status: row.status,
    createdAt: row.created_at,
  }));
}

/**
 * Revoke an API key
 */
export function revokeApiKey(
  db: Database.Database,
  apiKeyId: string
): void {
  db.prepare(
    "UPDATE api_keys SET status = 'revoked' WHERE id = ?"
  ).run(apiKeyId);
}
