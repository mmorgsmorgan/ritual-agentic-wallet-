/**
 * Webhook delivery worker.
 *
 * Polls the webhook_deliveries table for pending deliveries, POSTs them to
 * subscriber URLs with HMAC signature, and retries with exponential backoff
 * on failure.
 *
 * Signing scheme:
 *   header: Ritkey-Signature: t=<unix_ts>,v1=<hex_hmac_sha256>
 *   signed payload: `<unix_ts>.<raw_body>`
 *   key: subscription.secret
 *
 * This matches the Stripe webhook signing scheme so existing tooling/libraries
 * just work.
 */

import { createHmac } from 'crypto';
import { getDb } from '../db/database.js';
import {
  getSubscriptionWithSecret,
  recordDeliverySuccess,
  recordDeliveryFailure,
  resolveAndCheckHost,
} from './subscriptions.js';

const MAX_ATTEMPTS = 8;             // ~17 minutes total spread
const BACKOFF_BASE_SECONDS = 5;     // 5, 10, 20, 40, 80, 160, 320, 640
const DELIVERY_TIMEOUT_MS = 10_000; // 10 second per-request timeout
const POLL_INTERVAL_MS = 1_500;     // Check queue every 1.5 seconds
const MAX_RESPONSE_BYTES = 256;     // M1/H1: only store first 256 bytes of body

interface PendingDelivery {
  id: string;
  subscription_id: string;
  event_id: string;
  url: string;
  payload: string;
  attempts: number;
}

let workerHandle: NodeJS.Timeout | null = null;
let isProcessing = false;

/**
 * Start the background delivery worker.
 *
 * Call once at service startup. Safe to call multiple times — it's a no-op
 * if the worker is already running.
 */
export function startDeliveryWorker(): void {
  if (workerHandle) return;
  workerHandle = setInterval(processPendingDeliveries, POLL_INTERVAL_MS);
  // Don't block process exit on the timer
  workerHandle.unref?.();
}

/**
 * Stop the background delivery worker. Used in tests.
 */
export function stopDeliveryWorker(): void {
  if (workerHandle) {
    clearInterval(workerHandle);
    workerHandle = null;
  }
}

/**
 * Process all pending deliveries that are due.
 *
 * Exported for tests so they can trigger delivery synchronously.
 */
export async function processPendingDeliveries(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const due = getDb().prepare(
      `SELECT id, subscription_id, event_id, url, payload, attempts
       FROM webhook_deliveries
       WHERE status = 'pending'
         AND next_attempt_at <= datetime('now')
       ORDER BY created_at ASC
       LIMIT 50`
    ).all() as PendingDelivery[];

    if (due.length === 0) return;

    // Process in parallel but cap concurrency to avoid hammering subscribers
    await Promise.all(due.map((d) => deliverOne(d).catch((err) => {
      console.error(`[webhook] delivery ${d.id} threw:`, err);
    })));
  } finally {
    isProcessing = false;
  }
}

/**
 * Deliver a single webhook with HMAC signing.
 */
async function deliverOne(delivery: PendingDelivery): Promise<void> {
  const sub = getSubscriptionWithSecret(delivery.subscription_id);
  if (!sub) {
    // Subscription was deleted; mark delivery dead
    markDead(delivery.id, 'subscription_deleted');
    return;
  }

  const attemptNum = delivery.attempts + 1;
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${delivery.payload}`;
  const signature = createHmac('sha256', sub.secret).update(signedPayload).digest('hex');

  let status = 0;
  let responseBody = '';
  let success = false;
  let errorMsg: string | null = null;

  try {
    // H1: re-resolve hostname before each attempt. Defends DNS rebinding
    // between subscription registration and delivery.
    await resolveAndCheckHost(delivery.url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    const res = await fetch(delivery.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Ritkey-Webhook/1.0',
        'Ritkey-Signature': `t=${timestamp},v1=${signature}`,
        'Ritkey-Event-Id': delivery.event_id,
        'Ritkey-Delivery-Id': delivery.id,
        'Ritkey-Attempt': String(attemptNum),
      },
      body: delivery.payload,
      signal: controller.signal,
      redirect: 'manual',  // H1: never follow redirects (would bypass IP allowlist)
    });

    clearTimeout(timeoutId);

    status = res.status;

    // H1: refuse redirects from delivery. A redirect status with Location:
    // private-IP is the classic SSRF vector. Just mark this a delivery failure.
    if (status >= 300 && status < 400) {
      errorMsg = `redirect ${status} not allowed`;
      responseBody = '';
    } else {
      // M1/H1: only store first MAX_RESPONSE_BYTES of body for diagnostics.
      const bodyText = await res.text().catch(() => '');
      responseBody = bodyText.slice(0, MAX_RESPONSE_BYTES);

      success = status >= 200 && status < 300;
      if (!success) errorMsg = `HTTP ${status}`;
    }
  } catch (err: any) {
    errorMsg = err.name === 'AbortError' ? 'timeout' : (err.message ?? 'unknown error');
  }

  if (success) {
    getDb().prepare(
      `UPDATE webhook_deliveries
       SET status = 'delivered',
           attempts = ?,
           last_attempt_at = datetime('now'),
           response_status = ?,
           response_body = ?
       WHERE id = ?`
    ).run(attemptNum, status, responseBody, delivery.id);

    recordDeliverySuccess(delivery.subscription_id);
    return;
  }

  // Failed — schedule retry or mark dead
  if (attemptNum >= MAX_ATTEMPTS) {
    getDb().prepare(
      `UPDATE webhook_deliveries
       SET status = 'dead',
           attempts = ?,
           last_attempt_at = datetime('now'),
           last_error = ?,
           response_status = ?,
           response_body = ?
       WHERE id = ?`
    ).run(attemptNum, errorMsg, status || null, responseBody, delivery.id);

    recordDeliveryFailure(delivery.subscription_id);
    return;
  }

  // Exponential backoff: 5s, 10s, 20s, 40s, 80s, 160s, 320s, 640s
  const backoffSeconds = BACKOFF_BASE_SECONDS * Math.pow(2, delivery.attempts);

  getDb().prepare(
    `UPDATE webhook_deliveries
     SET status = 'pending',
         attempts = ?,
         last_attempt_at = datetime('now'),
         next_attempt_at = datetime('now', '+' || ? || ' seconds'),
         last_error = ?,
         response_status = ?,
         response_body = ?
     WHERE id = ?`
  ).run(attemptNum, backoffSeconds, errorMsg, status || null, responseBody, delivery.id);

  recordDeliveryFailure(delivery.subscription_id);
}

function markDead(deliveryId: string, reason: string): void {
  getDb().prepare(
    `UPDATE webhook_deliveries
     SET status = 'dead',
         last_attempt_at = datetime('now'),
         last_error = ?
     WHERE id = ?`
  ).run(reason, deliveryId);
}

// ============================================================
// Delivery log query (for /webhooks/:id/deliveries endpoint)
// ============================================================

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

export function listDeliveries(subscriptionId: string, limit = 50): DeliveryLogEntry[] {
  const rows = getDb().prepare(
    `SELECT id, event_id, status, attempts, url, response_status,
            last_error, created_at, last_attempt_at
     FROM webhook_deliveries
     WHERE subscription_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(subscriptionId, limit) as any[];

  return rows.map((r) => ({
    id: r.id,
    eventId: r.event_id,
    status: r.status,
    attempts: r.attempts,
    url: r.url,
    responseStatus: r.response_status,
    lastError: r.last_error,
    createdAt: r.created_at,
    lastAttemptAt: r.last_attempt_at,
  }));
}
