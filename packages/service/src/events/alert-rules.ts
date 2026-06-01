/**
 * Alert rules: persistence + CRUD.
 *
 * A rule attaches to a wallet (or to the owner globally) and specifies a
 * `kind` whose semantics the alert engine knows. The `config` blob is JSON
 * whose shape depends on `kind`.
 *
 * Rules are owned by an `api_key_hash`. Only the owner can read / update
 * / delete them. The engine evaluates rules irrespective of caller — it
 * reads them as the wallet's owner.
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import type { AlertSeverity } from './types.js';

export type AlertKind =
  | 'spend_threshold'
  | 'unusual_recipient'
  | 'key_export_warning'
  | 'balance_low';

export interface SpendThresholdConfig {
  /** Send an alert when a single tx.sent value (in RITUAL) exceeds this. */
  thresholdRitual: string;
}

export interface UnusualRecipientConfig {
  /** Lowercased addresses considered "known". Tx to any other address fires. */
  whitelist: string[];
}

export interface KeyExportWarningConfig {
  /** No config — every key.exported event for the watched wallet fires. */
}

export interface BalanceLowConfig {
  /** Fire when reported balance falls below this floor (in RITUAL). */
  floorRitual: string;
}

export type AlertConfig =
  | SpendThresholdConfig
  | UnusualRecipientConfig
  | KeyExportWarningConfig
  | BalanceLowConfig;

export interface AlertRule {
  id: string;
  apiKeyHash: string;
  /** null = rule applies to ALL of this owner's wallets */
  walletId: string | null;
  kind: AlertKind;
  config: AlertConfig;
  enabled: boolean;
  severity: AlertSeverity;
  label: string;
  createdAt: string;
}

export interface CreateRuleInput {
  apiKeyHash: string;
  walletId?: string | null;
  kind: AlertKind;
  config: AlertConfig;
  severity?: AlertSeverity;
  label?: string;
}

export interface UpdateRuleInput {
  enabled?: boolean;
  severity?: AlertSeverity;
  label?: string;
  config?: AlertConfig;
}

// ============================================================
// Limits
// ============================================================
const MAX_RULES_PER_OWNER = 100;
const MAX_LABEL_LENGTH = 256;
const MAX_WHITELIST_ADDRS = 1000;

// ============================================================
// CRUD
// ============================================================

export function createRule(input: CreateRuleInput): AlertRule {
  validateConfig(input.kind, input.config);
  if (input.label && input.label.length > MAX_LABEL_LENGTH) {
    throw new Error(`label too long (max ${MAX_LABEL_LENGTH})`);
  }

  const count = getDb().prepare(
    'SELECT COUNT(*) as n FROM alert_rules WHERE api_key_hash = ?'
  ).get(input.apiKeyHash) as { n: number };
  if (count.n >= MAX_RULES_PER_OWNER) {
    throw new Error(`Alert rule limit reached (${MAX_RULES_PER_OWNER} per owner)`);
  }

  const id = randomUUID();
  const severity = input.severity ?? 'warn';

  getDb().prepare(
    `INSERT INTO alert_rules (id, api_key_hash, wallet_id, kind, config, severity, label)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.apiKeyHash,
    input.walletId ?? null,
    input.kind,
    JSON.stringify(input.config),
    severity,
    input.label ?? ''
  );

  return {
    id,
    apiKeyHash: input.apiKeyHash,
    walletId: input.walletId ?? null,
    kind: input.kind,
    config: input.config,
    enabled: true,
    severity,
    label: input.label ?? '',
    createdAt: new Date().toISOString(),
  };
}

export function listRulesForOwner(apiKeyHash: string): AlertRule[] {
  const rows = getDb().prepare(
    `SELECT id, api_key_hash, wallet_id, kind, config, enabled, severity, label, created_at
     FROM alert_rules
     WHERE api_key_hash = ?
     ORDER BY created_at DESC`
  ).all(apiKeyHash) as any[];
  return rows.map(mapRow);
}

export function listRulesForWallet(walletId: string): AlertRule[] {
  // Rules that target this wallet OR are owner-global AND owned by the wallet's owner.
  const grant = getDb().prepare(
    'SELECT api_key_hash FROM api_key_grants WHERE wallet_id = ?'
  ).get(walletId) as { api_key_hash: string } | undefined;

  if (!grant) {
    // Wallet has no owner (OPEN_MODE or unbound) — only wallet-specific rules.
    return (getDb().prepare(
      `SELECT id, api_key_hash, wallet_id, kind, config, enabled, severity, label, created_at
       FROM alert_rules
       WHERE wallet_id = ? AND enabled = 1`
    ).all(walletId) as any[]).map(mapRow);
  }

  const rows = getDb().prepare(
    `SELECT id, api_key_hash, wallet_id, kind, config, enabled, severity, label, created_at
     FROM alert_rules
     WHERE enabled = 1
       AND api_key_hash = ?
       AND (wallet_id = ? OR wallet_id IS NULL)`
  ).all(grant.api_key_hash, walletId) as any[];
  return rows.map(mapRow);
}

export function getRule(id: string): AlertRule | null {
  const row = getDb().prepare(
    `SELECT id, api_key_hash, wallet_id, kind, config, enabled, severity, label, created_at
     FROM alert_rules
     WHERE id = ?`
  ).get(id) as any;
  if (!row) return null;
  return mapRow(row);
}

export function updateRule(id: string, apiKeyHash: string, patch: UpdateRuleInput): AlertRule | null {
  const existing = getDb().prepare(
    'SELECT * FROM alert_rules WHERE id = ? AND api_key_hash = ?'
  ).get(id, apiKeyHash) as any;
  if (!existing) return null;

  if (patch.config !== undefined) {
    validateConfig(existing.kind, patch.config);
  }
  if (patch.label && patch.label.length > MAX_LABEL_LENGTH) {
    throw new Error(`label too long (max ${MAX_LABEL_LENGTH})`);
  }

  const updates: string[] = [];
  const values: any[] = [];
  if (patch.enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(patch.enabled ? 1 : 0);
  }
  if (patch.severity !== undefined) {
    updates.push('severity = ?');
    values.push(patch.severity);
  }
  if (patch.label !== undefined) {
    updates.push('label = ?');
    values.push(patch.label);
  }
  if (patch.config !== undefined) {
    updates.push('config = ?');
    values.push(JSON.stringify(patch.config));
  }
  if (updates.length === 0) return mapRow(existing);

  values.push(id);
  getDb().prepare(
    `UPDATE alert_rules SET ${updates.join(', ')} WHERE id = ?`
  ).run(...values);

  return getRule(id);
}

export function deleteRule(id: string, apiKeyHash: string): boolean {
  const result = getDb().prepare(
    'DELETE FROM alert_rules WHERE id = ? AND api_key_hash = ?'
  ).run(id, apiKeyHash);
  return result.changes > 0;
}

// ============================================================
// Helpers
// ============================================================

function mapRow(row: any): AlertRule {
  return {
    id: row.id,
    apiKeyHash: row.api_key_hash,
    walletId: row.wallet_id,
    kind: row.kind as AlertKind,
    config: JSON.parse(row.config),
    enabled: row.enabled === 1,
    severity: row.severity as AlertSeverity,
    label: row.label,
    createdAt: row.created_at,
  };
}

function validateConfig(kind: AlertKind, config: AlertConfig): void {
  switch (kind) {
    case 'spend_threshold': {
      const c = config as SpendThresholdConfig;
      if (!c.thresholdRitual || !/^\d+(\.\d+)?$/.test(c.thresholdRitual)) {
        throw new Error('spend_threshold.config.thresholdRitual must be a positive decimal');
      }
      if (parseFloat(c.thresholdRitual) <= 0) {
        throw new Error('spend_threshold.config.thresholdRitual must be > 0');
      }
      break;
    }
    case 'unusual_recipient': {
      const c = config as UnusualRecipientConfig;
      if (!Array.isArray(c.whitelist)) {
        throw new Error('unusual_recipient.config.whitelist must be an array');
      }
      if (c.whitelist.length > MAX_WHITELIST_ADDRS) {
        throw new Error(`whitelist too long (max ${MAX_WHITELIST_ADDRS})`);
      }
      for (const addr of c.whitelist) {
        if (typeof addr !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(addr)) {
          throw new Error(`whitelist contains invalid address: ${addr}`);
        }
      }
      break;
    }
    case 'key_export_warning':
      // no config required
      break;
    case 'balance_low': {
      const c = config as BalanceLowConfig;
      if (!c.floorRitual || !/^\d+(\.\d+)?$/.test(c.floorRitual)) {
        throw new Error('balance_low.config.floorRitual must be a positive decimal');
      }
      break;
    }
    default:
      throw new Error(`Unknown alert kind: ${kind}`);
  }
}
