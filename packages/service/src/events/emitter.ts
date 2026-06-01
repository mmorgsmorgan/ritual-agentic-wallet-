/**
 * Event emitter — the heart of the event system.
 *
 * When wallet activity happens, code calls emitEvent() to:
 *  1. Persist the event to the database
 *  2. Enqueue webhook deliveries to all matching subscribers
 *
 * The actual webhook delivery runs in a background worker (see delivery.ts).
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import type { RitkeyEvent, EventType } from './types.js';
import { evaluateAlerts } from './alert-engine.js';

/**
 * Persist an event to the events table and enqueue webhook deliveries.
 *
 * This is synchronous from the caller's POV (database insert is fast).
 * Webhook delivery happens asynchronously in the background worker.
 */
export function emitEvent(event: Omit<RitkeyEvent, 'id' | 'timestamp'>): RitkeyEvent {
  const id = randomUUID();
  const timestamp = new Date().toISOString();

  const fullEvent = {
    id,
    timestamp,
    ...event,
  } as RitkeyEvent;

  const db = getDb();

  // 1. Persist event
  db.prepare(
    `INSERT INTO events (id, type, wallet_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    id,
    event.type,
    event.walletId,
    JSON.stringify(fullEvent),
    timestamp
  );

  // 2. Find matching webhook subscriptions and enqueue deliveries
  enqueueWebhookDeliveries(fullEvent);

  // 3. Evaluate alert rules. Each matching rule produces a derived
  //    alert.* event that is recursively persisted + enqueued. We do this
  //    AFTER the underlying delivery so a subscriber listening to both the
  //    raw event and the alert receives the raw one first.
  const derived = evaluateAlerts(fullEvent);
  for (const draft of derived) {
    // emitEvent recurses, but evaluateAlerts skips events whose type starts
    // with 'alert.', so we cannot infinitely loop.
    emitEvent(draft);
  }

  return fullEvent;
}

/**
 * Find all webhook subscriptions that match this event and enqueue deliveries.
 *
 * A subscription matches if:
 *   - It is active
 *   - Its event filter matches (either '*' or includes the specific event type)
 *   - (M7) For wallet-scoped events, the subscription's owner (api_key_hash)
 *     also owns the wallet via api_key_grants. This prevents cross-tenant
 *     leak of `key.exported`, `wallet.swept`, `tx.sent`, etc.
 */
function enqueueWebhookDeliveries(event: RitkeyEvent): void {
  const db = getDb();

  // For wallet-scoped events, look up the wallet owner once.
  let walletOwner: string | null = null;
  if (event.walletId) {
    const row = db.prepare(
      'SELECT api_key_hash FROM api_key_grants WHERE wallet_id = ?'
    ).get(event.walletId) as { api_key_hash: string } | undefined;
    walletOwner = row?.api_key_hash ?? null;
  }

  const subscriptions = db.prepare(
    `SELECT id, api_key_hash, url, secret, events_filter
     FROM webhook_subscriptions
     WHERE status = 'active'`
  ).all() as Array<{
    id: string;
    api_key_hash: string;
    url: string;
    secret: string;
    events_filter: string;
  }>;

  for (const sub of subscriptions) {
    const filter = JSON.parse(sub.events_filter) as string[];
    const matches = filter.includes('*') || filter.includes(event.type);
    if (!matches) continue;

    // M7: for wallet-scoped events with a known owner, only deliver to subs
    // owned by the same api_key_hash. Events without a walletId (system events
    // like webhook.test) deliver to all matching subs.
    if (walletOwner !== null && sub.api_key_hash !== walletOwner) {
      continue;
    }

    db.prepare(
      `INSERT INTO webhook_deliveries (
        id, subscription_id, event_id, url, payload,
        status, attempts, next_attempt_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', 0, datetime('now'), datetime('now'))`
    ).run(
      randomUUID(),
      sub.id,
      event.id,
      sub.url,
      JSON.stringify(event)
    );
  }
}

/**
 * List recent events (for debugging or webhook replay).
 */
export function listEvents(opts: {
  walletId?: string;
  eventType?: EventType;
  limit?: number;
}): RitkeyEvent[] {
  const db = getDb();
  const limit = opts.limit ?? 50;

  let query = 'SELECT payload FROM events WHERE 1=1';
  const params: any[] = [];

  if (opts.walletId) {
    query += ' AND wallet_id = ?';
    params.push(opts.walletId);
  }
  if (opts.eventType) {
    query += ' AND type = ?';
    params.push(opts.eventType);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(query).all(...params) as Array<{ payload: string }>;
  return rows.map((r) => JSON.parse(r.payload) as RitkeyEvent);
}

/**
 * Get a specific event by ID.
 */
export function getEvent(eventId: string): RitkeyEvent | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT payload FROM events WHERE id = ?'
  ).get(eventId) as { payload: string } | undefined;

  if (!row) return null;
  return JSON.parse(row.payload) as RitkeyEvent;
}
