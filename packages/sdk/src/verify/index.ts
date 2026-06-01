/**
 * Webhook verification helper for receivers.
 *
 * Use this on YOUR endpoint that receives webhook deliveries from Ritkey:
 *
 *   import { verifyWebhook } from '@ritkey/sdk';
 *
 *   app.post('/ritkey-hook', async (req, res) => {
 *     const rawBody = await readRawBody(req);
 *     const result = verifyWebhook(rawBody, req.headers['ritkey-signature'], MY_SECRET);
 *     if (!result.ok) return res.status(401).end(result.reason);
 *     // result.event is now a typed RitkeyEvent
 *     handleEvent(result.event);
 *     res.status(200).end();
 *   });
 *
 * IMPORTANT: rawBody must be the EXACT bytes Ritkey sent. If your framework
 * parses JSON before you see the body, your HMAC will not match. Use a raw
 * body parser for the webhook route.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RitkeyEvent, EventType } from '../types.js';

export interface VerifyOptions {
  /**
   * Reject signatures older than this many seconds. Defaults to 300 (5 min).
   * Set to 0 to disable timestamp check (NOT recommended).
   */
  toleranceSeconds?: number;
  /** Override "now" for tests. */
  nowSeconds?: number;
}

export type VerifyResult<T = unknown> =
  | { ok: true; event: RitkeyEvent<T>; timestamp: number }
  | { ok: false; reason: string };

const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Verify a Ritkey webhook delivery.
 *
 * @param rawBody  The exact request body bytes (string or Buffer).
 * @param sigHeader The value of the `Ritkey-Signature` header. May be undefined / string[] / string.
 * @param secret   Your subscription's `whsec_...` secret.
 * @param opts     Optional tolerance / clock override.
 */
export function verifyWebhook<T = unknown>(
  rawBody: string | Uint8Array,
  sigHeader: string | string[] | undefined,
  secret: string,
  opts: VerifyOptions = {}
): VerifyResult<T> {
  if (!secret) return { ok: false, reason: 'missing secret' };

  const header = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  if (!header) return { ok: false, reason: 'missing Ritkey-Signature header' };

  // Parse `t=<ts>,v1=<hex>` — order-independent.
  let tStr: string | undefined;
  let v1Str: string | undefined;
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === 't') tStr = v;
    else if (k === 'v1') v1Str = v;
  }
  if (!tStr || !v1Str) return { ok: false, reason: 'malformed Ritkey-Signature header' };

  const timestamp = parseInt(tStr, 10);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: 'invalid timestamp in signature' };
  }

  // Timestamp tolerance check (replay protection).
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (tolerance > 0) {
    const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > tolerance) {
      return { ok: false, reason: 'signature timestamp outside tolerance window' };
    }
  }

  // Compute expected HMAC over `<t>.<rawBody>`.
  const bodyStr = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody).toString('utf8');
  const signedPayload = `${tStr}.${bodyStr}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');

  // Timing-safe compare. Lengths must match before timingSafeEqual.
  const expBuf = Buffer.from(expected, 'hex');
  let provBuf: Buffer;
  try {
    provBuf = Buffer.from(v1Str, 'hex');
  } catch {
    return { ok: false, reason: 'invalid signature encoding' };
  }
  if (expBuf.length !== provBuf.length) {
    return { ok: false, reason: 'signature mismatch' };
  }
  if (!timingSafeEqual(expBuf, provBuf)) {
    return { ok: false, reason: 'signature mismatch' };
  }

  // Parse the event payload.
  let event: RitkeyEvent<T>;
  try {
    event = JSON.parse(bodyStr) as RitkeyEvent<T>;
  } catch {
    return { ok: false, reason: 'body is not valid JSON' };
  }

  return { ok: true, event, timestamp };
}

/**
 * Narrow a verified event to a specific type tag.
 *
 *   if (isEvent(result.event, 'tx.sent')) {
 *     // result.event.data is now typed
 *   }
 */
export function isEvent<E extends EventType>(
  event: RitkeyEvent,
  type: E
): event is RitkeyEvent & { type: E } {
  return event.type === type;
}
