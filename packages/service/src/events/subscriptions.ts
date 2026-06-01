/**
 * Webhook subscription management.
 *
 * Subscriptions are owned by an api_key_hash (sha256 of the bearer token).
 * In OPEN_MODE the api_key_hash is the literal string 'open'.
 */

import { randomBytes, randomUUID } from 'crypto';
import { promises as dnsPromises } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { getDb } from '../db/database.js';
import { ALL_EVENT_TYPES, type EventType } from './types.js';

// ============================================================
// Limits (M6)
// ============================================================
const MAX_URL_LENGTH = 2048;
const MAX_LABEL_LENGTH = 256;
const MAX_SUBS_PER_OWNER = 20;

export interface WebhookSubscription {
  id: string;
  apiKeyHash: string;
  url: string;
  secret: string;              // Only returned at creation; never re-shown
  eventsFilter: string[];      // ['*'] or specific event types
  label: string;
  status: 'active' | 'paused' | 'disabled';
  createdAt: string;
  lastDeliveryAt: string | null;
  consecutiveFailures: number;
}

export interface CreateSubscriptionInput {
  apiKeyHash: string;
  url: string;
  events?: EventType[] | ['*'];
  label?: string;
}

/**
 * Create a new webhook subscription.
 *
 * Generates a fresh HMAC secret. The secret is returned ONCE; the caller
 * must save it. After this, the secret is only used internally for signing
 * outbound deliveries.
 *
 * The secret is encrypted at rest using the service encryption key — see
 * `encryptedSecret` below.
 */
export async function createSubscription(input: CreateSubscriptionInput): Promise<WebhookSubscription> {
  await ensureWebhookCryptoReady();
  await validateUrl(input.url);

  const events = input.events ?? ['*'];
  validateEvents(events);
  validateLengths(input);

  // Enforce per-owner sub cap (M6).
  const countRow = getDb().prepare(
    'SELECT COUNT(*) as n FROM webhook_subscriptions WHERE api_key_hash = ?'
  ).get(input.apiKeyHash) as { n: number };
  if (countRow.n >= MAX_SUBS_PER_OWNER) {
    throw new Error(`Subscription limit reached (${MAX_SUBS_PER_OWNER} per owner)`);
  }

  const id = randomUUID();
  const secret = `whsec_${randomBytes(32).toString('hex')}`;
  const encryptedSecret = encryptSecretForStorage(secret);

  getDb().prepare(
    `INSERT INTO webhook_subscriptions (id, api_key_hash, url, secret, events_filter, label)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.apiKeyHash,
    input.url,
    encryptedSecret,
    JSON.stringify(events),
    input.label ?? ''
  );

  return {
    id,
    apiKeyHash: input.apiKeyHash,
    url: input.url,
    secret, // returned plaintext once at creation
    eventsFilter: events,
    label: input.label ?? '',
    status: 'active',
    createdAt: new Date().toISOString(),
    lastDeliveryAt: null,
    consecutiveFailures: 0,
  };
}

/**
 * List subscriptions owned by an api_key_hash.
 *
 * Note: secret is NOT included in the response (only at creation).
 */
export function listSubscriptions(apiKeyHash: string): Omit<WebhookSubscription, 'secret'>[] {
  const rows = getDb().prepare(
    `SELECT id, api_key_hash, url, events_filter, label, status,
            created_at, last_delivery_at, consecutive_failures
     FROM webhook_subscriptions
     WHERE api_key_hash = ?
     ORDER BY created_at DESC`
  ).all(apiKeyHash) as any[];

  return rows.map(mapRow);
}

/**
 * Get a single subscription (without secret).
 */
export function getSubscription(id: string): Omit<WebhookSubscription, 'secret'> | null {
  const row = getDb().prepare(
    `SELECT id, api_key_hash, url, events_filter, label, status,
            created_at, last_delivery_at, consecutive_failures
     FROM webhook_subscriptions
     WHERE id = ?`
  ).get(id) as any;

  if (!row) return null;
  return mapRow(row);
}

/**
 * Internal: fetch subscription WITH decrypted secret (for delivery signing).
 *
 * The secret column on disk is encrypted with the service encryption key
 * (H3 fix). Plaintext secret is only materialized in memory during signing.
 */
export function getSubscriptionWithSecret(id: string): WebhookSubscription | null {
  const row = getDb().prepare(
    `SELECT id, api_key_hash, url, secret, events_filter, label, status,
            created_at, last_delivery_at, consecutive_failures
     FROM webhook_subscriptions
     WHERE id = ?`
  ).get(id) as any;

  if (!row) return null;

  let plaintextSecret: string;
  try {
    plaintextSecret = decryptSecretFromStorage(row.secret);
  } catch {
    // Backward compat: rows written before H3 fix are plaintext.
    // Detect by the `whsec_` prefix being present already.
    if (typeof row.secret === 'string' && row.secret.startsWith('whsec_')) {
      plaintextSecret = row.secret;
    } else {
      throw new Error(`Could not decrypt webhook secret for sub ${id}`);
    }
  }

  return { ...mapRow(row), secret: plaintextSecret };
}

/**
 * Update a subscription's mutable fields.
 */
export async function updateSubscription(
  id: string,
  apiKeyHash: string,
  patch: Partial<{ url: string; events: EventType[] | ['*']; label: string; status: 'active' | 'paused' }>
): Promise<Omit<WebhookSubscription, 'secret'> | null> {
  const existing = getDb().prepare(
    'SELECT * FROM webhook_subscriptions WHERE id = ? AND api_key_hash = ?'
  ).get(id, apiKeyHash) as any;

  if (!existing) return null;

  if (patch.url !== undefined) await validateUrl(patch.url);
  if (patch.events !== undefined) validateEvents(patch.events);
  validateLengths({ url: patch.url ?? '', label: patch.label, events: patch.events });

  const updates: string[] = [];
  const values: any[] = [];

  if (patch.url !== undefined) {
    updates.push('url = ?');
    values.push(patch.url);
  }
  if (patch.events !== undefined) {
    updates.push('events_filter = ?');
    values.push(JSON.stringify(patch.events));
  }
  if (patch.label !== undefined) {
    updates.push('label = ?');
    values.push(patch.label);
  }
  if (patch.status !== undefined) {
    updates.push('status = ?');
    values.push(patch.status);
  }

  if (updates.length === 0) return mapRow(existing);

  values.push(id);
  getDb().prepare(
    `UPDATE webhook_subscriptions SET ${updates.join(', ')} WHERE id = ?`
  ).run(...values);

  return getSubscription(id);
}

/**
 * Delete a subscription (and cascade-delete its delivery queue).
 */
export function deleteSubscription(id: string, apiKeyHash: string): boolean {
  const result = getDb().prepare(
    'DELETE FROM webhook_subscriptions WHERE id = ? AND api_key_hash = ?'
  ).run(id, apiKeyHash);

  return result.changes > 0;
}

/**
 * Record a successful delivery.
 */
export function recordDeliverySuccess(subscriptionId: string): void {
  getDb().prepare(
    `UPDATE webhook_subscriptions
     SET last_delivery_at = datetime('now'),
         consecutive_failures = 0
     WHERE id = ?`
  ).run(subscriptionId);
}

/**
 * Record a delivery failure. Auto-disables subscription after 10 consecutive failures.
 */
export function recordDeliveryFailure(subscriptionId: string): { autoDisabled: boolean } {
  const result = getDb().prepare(
    `UPDATE webhook_subscriptions
     SET consecutive_failures = consecutive_failures + 1
     WHERE id = ?
     RETURNING consecutive_failures`
  ).get(subscriptionId) as { consecutive_failures: number } | undefined;

  const failures = result?.consecutive_failures ?? 0;

  if (failures >= 10) {
    getDb().prepare(
      "UPDATE webhook_subscriptions SET status = 'disabled' WHERE id = ?"
    ).run(subscriptionId);
    return { autoDisabled: true };
  }

  return { autoDisabled: false };
}

// ============================================================
// Helpers
// ============================================================

function mapRow(row: any): Omit<WebhookSubscription, 'secret'> {
  return {
    id: row.id,
    apiKeyHash: row.api_key_hash,
    url: row.url,
    eventsFilter: JSON.parse(row.events_filter),
    label: row.label,
    status: row.status,
    createdAt: row.created_at,
    lastDeliveryAt: row.last_delivery_at,
    consecutiveFailures: row.consecutive_failures,
  };
}

// ----- H3: encrypt/decrypt webhook secret at rest -----
// We lazy-import @ritkey/core to defer loadConfig() until env is set up.

let cachedKey: string | null = null;
let cachedEncryptShard: ((plaintext: string, key: string) => string) | null = null;
let cachedDecryptShard: ((ciphertext: string, key: string) => string) | null = null;

/**
 * Must be called once at service startup so encryption helpers are ready
 * before any subscription is created or read.
 */
export async function ensureWebhookCryptoReady(): Promise<void> {
  if (cachedKey && cachedEncryptShard && cachedDecryptShard) return;
  const core = await import('@ritkey/core');
  cachedKey = core.loadConfig().encryptionKey;
  cachedEncryptShard = core.encryptShard;
  cachedDecryptShard = core.decryptShard;
}

function encryptSecretForStorage(plaintext: string): string {
  if (!cachedKey || !cachedEncryptShard) {
    throw new Error('Encryption key not initialized; call ensureWebhookCryptoReady() first');
  }
  return cachedEncryptShard(plaintext, cachedKey);
}

function decryptSecretFromStorage(ciphertext: string): string {
  if (!cachedKey || !cachedDecryptShard) {
    throw new Error('Encryption key not initialized');
  }
  return cachedDecryptShard(ciphertext, cachedKey);
}

// ----- H1: SSRF-safe URL validation with DNS resolution -----

/** RFC1918 + loopback + link-local + carrier-grade-NAT + ULA */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts as [number, number];
  if (a === 10) return true;                          // 10.0.0.0/8
  if (a === 127) return true;                         // loopback
  if (a === 0) return true;                           // 0.0.0.0/8
  if (a === 169 && b === 254) return true;            // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16/12
  if (a === 192 && b === 168) return true;            // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT 100.64/10
  if (a >= 224) return true;                          // multicast/reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
  if (lower.startsWith('ff')) return true; // multicast
  // IPv4-mapped IPv6: ::ffff:127.0.0.1
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7);
    if (isIP(v4) === 4) return isPrivateIPv4(v4);
  }
  return false;
}

/**
 * Validate a webhook URL.
 *  - Scheme must be HTTPS (or HTTP in dev).
 *  - Hostname must be a strict hostname OR a public IP literal.
 *  - Resolves the hostname and rejects if any A/AAAA record is private.
 *  - Rejects non-canonical IP encodings (decimal/octal/userinfo tricks).
 */
async function validateUrl(url: string): Promise<void> {
  if (url.length > MAX_URL_LENGTH) {
    throw new Error(`Webhook URL too long (max ${MAX_URL_LENGTH})`);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid webhook URL');
  }

  const allowInsecure =
    process.env.NODE_ENV === 'development' ||
    process.env.RITKEY_ALLOW_INSECURE_WEBHOOKS === 'true';

  if (parsed.protocol !== 'https:' && !(allowInsecure && parsed.protocol === 'http:')) {
    throw new Error('Webhook URL must use HTTPS');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Webhook URL must not contain userinfo (user:pass@)');
  }

  const host = parsed.hostname;

  // Reject empty/single-char hostnames (e.g., http://0/ → 0.0.0.0).
  if (!host || host.length < 2) {
    throw new Error('Webhook hostname too short / invalid');
  }

  // If hostname is an IP literal, check it directly.
  const ipKind = isIP(host) || isIP(host.replace(/^\[|\]$/g, ''));
  if (ipKind === 4) {
    if (isPrivateIPv4(host) && !allowInsecure) {
      throw new Error('Webhook URL cannot point to a private IPv4 address');
    }
    return;
  }
  if (ipKind === 6) {
    const bare = host.replace(/^\[|\]$/g, '');
    if (isPrivateIPv6(bare) && !allowInsecure) {
      throw new Error('Webhook URL cannot point to a private IPv6 address');
    }
    return;
  }

  // Reject obviously non-hostname formats: pure digits (decimal IP), starts-with-digit-and-no-dot, etc.
  if (/^\d+$/.test(host)) {
    throw new Error('Webhook URL hostname appears to be a decimal-encoded IP');
  }
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(host)) {
    throw new Error('Webhook URL hostname is not a valid DNS name');
  }

  // Block obvious localhost-ish hostnames before DNS resolution.
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal') {
    throw new Error('Webhook URL cannot point to localhost / cloud metadata');
  }

  if (allowInsecure) return; // dev: skip DNS resolution

  // Resolve and check every record. (Defends DNS rebinding at registration time;
  // delivery worker re-checks again at request time.)
  let addresses: LookupAddress[];
  try {
    addresses = await dnsPromises.lookup(host, { all: true });
  } catch {
    throw new Error('Webhook URL hostname does not resolve');
  }
  if (addresses.length === 0) {
    throw new Error('Webhook URL hostname did not resolve to any address');
  }
  for (const { address, family } of addresses) {
    if (family === 4 && isPrivateIPv4(address)) {
      throw new Error(`Webhook URL hostname resolves to private IPv4 ${address}`);
    }
    if (family === 6 && isPrivateIPv6(address)) {
      throw new Error(`Webhook URL hostname resolves to private IPv6 ${address}`);
    }
  }
}

function validateEvents(events: string[]): void {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('events must be a non-empty array');
  }
  if (events.length > ALL_EVENT_TYPES.length + 1) {
    throw new Error('events array too large');
  }
  for (const e of events) {
    if (e === '*') continue;
    if (!ALL_EVENT_TYPES.includes(e as EventType)) {
      throw new Error(`Unknown event type: ${e}. Valid types: ${ALL_EVENT_TYPES.join(', ')} or "*"`);
    }
  }
}

function validateLengths(input: { url?: string; label?: string; events?: string[] }): void {
  if (input.url && input.url.length > MAX_URL_LENGTH) {
    throw new Error(`url too long (max ${MAX_URL_LENGTH})`);
  }
  if (input.label && input.label.length > MAX_LABEL_LENGTH) {
    throw new Error(`label too long (max ${MAX_LABEL_LENGTH})`);
  }
}

/**
 * Public helper to safely re-resolve a URL's hostname at delivery time.
 * Returns the resolved IPv4/IPv6 to be used in fetch, or throws if it has
 * rebound to a private address since validation.
 *
 * In dev (NODE_ENV=development or RITKEY_ALLOW_INSECURE_WEBHOOKS=true),
 * we skip the private-IP check so local-loopback testing works.
 */
export async function resolveAndCheckHost(url: string): Promise<void> {
  const allowInsecure =
    process.env.NODE_ENV === 'development' ||
    process.env.RITKEY_ALLOW_INSECURE_WEBHOOKS === 'true';
  if (allowInsecure) return;

  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const ipKind = isIP(host);
  if (ipKind === 4) {
    if (isPrivateIPv4(host)) throw new Error('rebound to private IPv4');
    return;
  }
  if (ipKind === 6) {
    if (isPrivateIPv6(host)) throw new Error('rebound to private IPv6');
    return;
  }
  let addresses: LookupAddress[];
  try {
    addresses = await dnsPromises.lookup(host, { all: true });
  } catch {
    throw new Error('hostname did not resolve at delivery time');
  }
  for (const { address, family } of addresses) {
    if (family === 4 && isPrivateIPv4(address)) {
      throw new Error(`rebound to private IPv4 ${address}`);
    }
    if (family === 6 && isPrivateIPv6(address)) {
      throw new Error(`rebound to private IPv6 ${address}`);
    }
  }
}
