/**
 * Shared types for the Ritkey SDK.
 *
 * These mirror the wire format of the @ritkey/service HTTP API. Where the
 * server returns extra `_notice` / `_security` documentation fields, the SDK
 * forwards them so apps can show them to users on first wallet creation.
 */

// ============================================================
// Wallets
// ============================================================

export type WalletType = 'xor' | 'threshold';
export type WalletStatus = 'active' | 'frozen' | 'archived';

/** Full wallet view from POST /wallets and POST /wallets/import (creation responses). */
export interface CreatedWallet {
  walletId: string;
  address: string;
  publicKey: string;
  /** Returned ONCE — save it. Used as one of two shares for signing. */
  agentShard: string;
  /** Returned ONCE — store offline (cold storage). The third share. */
  backupShard: string;
  walletType: WalletType;
  threshold: number;
  totalShares: number;
  label: string;
  createdAt: string;
}

/** Wallet view from GET /wallets/:id (no shards). */
export interface Wallet {
  id: string;
  address: string;
  publicKey: string;
  label: string;
  status: WalletStatus;
  createdAt: string;
  fundedAt?: string | null;
}

export interface SendTransactionInput {
  walletId: string;
  agentShard: string;
  to: string;
  value: string; // RITUAL (decimal string)
  data?: string;
}

export interface SignMessageInput {
  walletId: string;
  agentShard: string;
  message: string;
}

export interface ExportKeyInput {
  walletId: string;
  agentShard: string;
  /**
   * Optional. If provided, the server uses agentShard+backupShard for
   * reconstruction without combining its own shard (server-less mode).
   */
  backupShard?: string;
}

export interface SweepInput {
  walletId: string;
  agentShard: string;
  sweepTo: string;
}

export interface SentTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  walletType: WalletType;
  explorer: string;
}

export interface BalanceResponse {
  address: string;
  native: { wei: string; formatted: string; symbol: 'RITUAL' };
  ritualWallet: {
    balance: string;
    formatted: string;
    lockUntil: string;
    isLocked: boolean;
  };
  currentBlock: string;
}

export interface ExportedKey {
  walletId: string;
  address: string;
  privateKey: string;
  status: 'archived';
}

// ============================================================
// Webhooks
// ============================================================

export type SubscriptionStatus = 'active' | 'paused' | 'disabled';

export type EventType =
  | 'wallet.created'
  | 'wallet.imported'
  | 'wallet.frozen'
  | 'wallet.unfrozen'
  | 'wallet.archived'
  | 'wallet.funded'
  | 'wallet.swept'
  | 'tx.sent'
  | 'tx.received'
  | 'message.signed'
  | 'ritual.deposited'
  | 'key.exported'
  | 'webhook.test'
  | 'alert.spend_threshold'
  | 'alert.unusual_recipient'
  | 'alert.key_export_warning'
  | 'alert.balance_low';

export interface WebhookSubscription {
  id: string;
  url: string;
  eventsFilter: (EventType | '*')[];
  label: string;
  status: SubscriptionStatus;
  createdAt: string;
  lastDeliveryAt: string | null;
  consecutiveFailures: number;
}

/** POST /webhooks response — includes the one-time signing secret. */
export interface CreatedWebhook extends WebhookSubscription {
  secret: string;
}

export interface CreateWebhookInput {
  url: string;
  events?: (EventType | '*')[];
  label?: string;
}

export interface UpdateWebhookInput {
  url?: string;
  events?: (EventType | '*')[];
  label?: string;
  status?: 'active' | 'paused';
}

export interface DeliveryLogEntry {
  id: string;
  eventId: string;
  status: 'pending' | 'delivered' | 'failed' | 'dead';
  attempts: number;
  url: string;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: string;
  lastAttemptAt: string | null;
}

// ============================================================
// Events
// ============================================================

export interface BaseEvent {
  id: string;
  type: EventType;
  timestamp: string;
  walletId: string | null;
}

/** Each event's `data` shape is type-specific; we keep it loose at the SDK
 * boundary so the wire format can evolve without breaking changes. Use
 * the type tag to narrow. */
export interface RitkeyEvent<T = unknown> extends BaseEvent {
  data: T;
}

// ============================================================
// Alerts
// ============================================================

export type AlertKind =
  | 'spend_threshold'
  | 'unusual_recipient'
  | 'key_export_warning'
  | 'balance_low';

export type AlertSeverity = 'info' | 'warn' | 'critical';

export interface SpendThresholdConfig {
  thresholdRitual: string;
}
export interface UnusualRecipientConfig {
  whitelist: string[];
}
export interface KeyExportWarningConfig {}
export interface BalanceLowConfig {
  floorRitual: string;
}

export type AlertConfig =
  | SpendThresholdConfig
  | UnusualRecipientConfig
  | KeyExportWarningConfig
  | BalanceLowConfig;

export interface AlertRule {
  id: string;
  walletId: string | null;
  kind: AlertKind;
  config: AlertConfig;
  enabled: boolean;
  severity: AlertSeverity;
  label: string;
  createdAt: string;
}

export interface CreateAlertRuleInput {
  walletId: string;
  kind: AlertKind;
  config: AlertConfig;
  severity?: AlertSeverity;
  label?: string;
}

export interface UpdateAlertRuleInput {
  enabled?: boolean;
  severity?: AlertSeverity;
  label?: string;
  config?: AlertConfig;
}

// ============================================================
// SDK config + errors
// ============================================================

export interface RitkeyClientConfig {
  /** Base URL, e.g. https://ritkey.example.com */
  baseUrl: string;
  /** Bearer API key. Required unless your server is in OPEN_MODE. */
  apiKey?: string;
  /** Override fetch impl (for testing, custom retry, etc.) */
  fetch?: typeof fetch;
  /** Default per-request timeout in ms. Default: 30_000 */
  timeoutMs?: number;
}

export class RitkeyError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown, code?: string) {
    super(message);
    this.name = 'RitkeyError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}
