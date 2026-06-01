/**
 * Event types emitted by Ritkey.
 *
 * Webhook subscribers receive these events as JSON payloads.
 */

export type EventType =
  // Wallet lifecycle
  | 'wallet.created'         // New wallet generated
  | 'wallet.imported'        // External key imported
  | 'wallet.frozen'          // Wallet frozen
  | 'wallet.unfrozen'        // Wallet unfrozen
  | 'wallet.archived'        // Wallet archived
  // Transactions
  | 'tx.sent'                // Transaction broadcast
  | 'tx.received'            // Wallet received funds (future)
  // Signing
  | 'message.signed'         // Off-chain message signed
  // Funding
  | 'wallet.funded'          // Faucet drip claimed
  // RitualWallet escrow
  | 'ritual.deposited'       // Funds deposited to RitualWallet
  // Security events
  | 'key.exported'           // Private key exported (CRITICAL)
  | 'wallet.swept'           // Funds swept and archived
  // Webhook events
  | 'webhook.test'           // Test event (for verifying webhook setup)
  // ── Derived alerts (produced by the alert engine) ─────────
  | 'alert.spend_threshold'  // tx.sent value exceeded a per-wallet threshold
  | 'alert.unusual_recipient' // tx.sent went to an address not on the wallet's whitelist
  | 'alert.key_export_warning' // key.exported fired — surface as high-severity alert
  | 'alert.balance_low';     // wallet balance fell below a configured floor

/**
 * Base event payload — every event has these fields.
 */
export interface BaseEvent {
  id: string;                // UUID for this event
  type: EventType;           // Event type
  timestamp: string;         // ISO 8601 timestamp
  walletId: string | null;   // Wallet this event relates to (null for system events)
}

/**
 * Event payloads by type.
 *
 * Each event has a specific data shape so subscribers can type-check.
 */
export interface WalletCreatedEvent extends BaseEvent {
  type: 'wallet.created';
  data: {
    walletId: string;
    address: string;
    label: string;
    walletType: 'xor' | 'threshold';
    threshold: number | null;
  };
}

export interface WalletImportedEvent extends BaseEvent {
  type: 'wallet.imported';
  data: {
    walletId: string;
    address: string;
    label: string;
  };
}

export interface TxSentEvent extends BaseEvent {
  type: 'tx.sent';
  data: {
    walletId: string;
    hash: string;
    from: string;
    to: string;
    value: string;           // Wei
    valueFormatted: string;  // RITUAL
    data: string;
    explorer: string;
  };
}

export interface TxReceivedEvent extends BaseEvent {
  type: 'tx.received';
  data: {
    walletId: string;
    address: string;            // recipient wallet address
    from: string;
    hash: string;
    value: string;              // Wei
    valueFormatted: string;     // RITUAL
    blockNumber: string;
    explorer: string;
  };
}

export interface MessageSignedEvent extends BaseEvent {
  type: 'message.signed';
  data: {
    walletId: string;
    address: string;
    messagePreview: string;  // First 100 chars
  };
}

export interface WalletFundedEvent extends BaseEvent {
  type: 'wallet.funded';
  data: {
    walletId: string;
    address: string;
    amount: string;
    hash: string;
  };
}

export interface RitualDepositedEvent extends BaseEvent {
  type: 'ritual.deposited';
  data: {
    walletId: string;
    amount: string;
    lockDuration: number;
    hash: string;
  };
}

export interface KeyExportedEvent extends BaseEvent {
  type: 'key.exported';
  data: {
    walletId: string;
    address: string;
    method: 'server+agent' | 'agent+backup';
  };
}

export interface WalletStatusEvent extends BaseEvent {
  type: 'wallet.frozen' | 'wallet.unfrozen' | 'wallet.archived';
  data: {
    walletId: string;
    address: string;
    previousStatus: string;
    newStatus: string;
  };
}

export interface WalletSweptEvent extends BaseEvent {
  type: 'wallet.swept';
  data: {
    walletId: string;
    address: string;
    sweepTo: string;
    sweepTxHash: string | null;
    swept: boolean;
  };
}

export interface WebhookTestEvent extends BaseEvent {
  type: 'webhook.test';
  walletId: null;
  data: {
    message: string;
  };
}

// ============================================================
// Alert events (emitted by the alert engine)
// ============================================================

export type AlertSeverity = 'info' | 'warn' | 'critical';

export interface SpendThresholdAlertEvent extends BaseEvent {
  type: 'alert.spend_threshold';
  data: {
    ruleId: string;
    walletId: string;
    severity: AlertSeverity;
    thresholdRitual: string;          // e.g. "0.5"
    txValueRitual: string;
    txHash: string;
    to: string;
    triggeringEventId: string;        // tx.sent event id
  };
}

export interface UnusualRecipientAlertEvent extends BaseEvent {
  type: 'alert.unusual_recipient';
  data: {
    ruleId: string;
    walletId: string;
    severity: AlertSeverity;
    to: string;
    txHash: string;
    txValueRitual: string;
    triggeringEventId: string;
  };
}

export interface KeyExportWarningAlertEvent extends BaseEvent {
  type: 'alert.key_export_warning';
  data: {
    ruleId: string;
    walletId: string;
    severity: 'critical';
    address: string;
    method: 'server+agent' | 'agent+backup';
    triggeringEventId: string;
  };
}

export interface BalanceLowAlertEvent extends BaseEvent {
  type: 'alert.balance_low';
  data: {
    ruleId: string;
    walletId: string;
    severity: AlertSeverity;
    floorRitual: string;
    currentBalanceRitual: string;
    triggeringEventId: string;
  };
}

export type RitkeyEvent =
  | WalletCreatedEvent
  | WalletImportedEvent
  | TxSentEvent
  | TxReceivedEvent
  | MessageSignedEvent
  | WalletFundedEvent
  | RitualDepositedEvent
  | KeyExportedEvent
  | WalletStatusEvent
  | WalletSweptEvent
  | WebhookTestEvent
  | SpendThresholdAlertEvent
  | UnusualRecipientAlertEvent
  | KeyExportWarningAlertEvent
  | BalanceLowAlertEvent;

/**
 * All supported event types as a frozen array (for validation).
 */
export const ALL_EVENT_TYPES: readonly EventType[] = Object.freeze([
  'wallet.created',
  'wallet.imported',
  'wallet.frozen',
  'wallet.unfrozen',
  'wallet.archived',
  'tx.sent',
  'tx.received',
  'message.signed',
  'wallet.funded',
  'ritual.deposited',
  'key.exported',
  'wallet.swept',
  'webhook.test',
  'alert.spend_threshold',
  'alert.unusual_recipient',
  'alert.key_export_warning',
  'alert.balance_low',
]);
