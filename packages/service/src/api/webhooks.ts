/**
 * Webhook REST endpoints.
 *
 *   POST   /webhooks                       Register a subscription
 *   GET    /webhooks                       List my subscriptions
 *   GET    /webhooks/events                Supported event types
 *   GET    /webhooks/:id                   Get one subscription
 *   PATCH  /webhooks/:id                   Update url/events/label/status
 *   DELETE /webhooks/:id                   Remove subscription
 *   POST   /webhooks/:id/test              Fire a webhook.test event
 *   GET    /webhooks/:id/deliveries        Recent delivery attempts
 *   GET    /events                         Recent events (debugging)
 *
 * Security (post-audit fixes):
 *   - H2: webhook endpoints refuse to operate in OPEN_MODE because we can't
 *     attribute ownership to a caller. OPEN_MODE is loopback-only by design.
 *   - H6: /webhooks/:id/test enqueues a single delivery to *this* subscription,
 *     not via the global event fanout (which would cross-deliver to others).
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  createSubscription,
  listSubscriptions,
  getSubscription,
  updateSubscription,
  deleteSubscription,
} from '../events/subscriptions.js';
import { listEvents } from '../events/emitter.js';
import { listDeliveries, processPendingDeliveries } from '../events/delivery.js';
import { ALL_EVENT_TYPES } from '../events/types.js';
import { getDb } from '../db/database.js';
import { authMiddleware, validate } from './middleware.js';

const CreateSubSchema = z.object({
  url: z.string().url('Invalid URL'),
  events: z.array(z.string()).optional(),
  label: z.string().optional(),
});

const UpdateSubSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.string()).optional(),
  label: z.string().optional(),
  status: z.enum(['active', 'paused']).optional(),
});

function param(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] || '';
  return val || '';
}

/**
 * H2: in OPEN_MODE all callers are anonymous and would share one bucket.
 * Refuse webhook operations to avoid the cross-tenant clobber issue.
 */
function requireAuthMode(req: any, res: any): boolean {
  if (req.apiKeyHash == null) {
    res.status(400).json({
      error: 'Webhook operations require authenticated mode (set API_KEY)',
      code: 'webhooks_require_auth',
    });
    return false;
  }
  return true;
}

function ownerKey(req: any): string {
  return req.apiKeyHash as string;
}

export function registerWebhookRoutes(app: Router): void {
  /**
   * POST /webhooks — Register a new subscription
   */
  app.post('/webhooks', authMiddleware, validate(CreateSubSchema), async (req, res) => {
    if (!requireAuthMode(req, res)) return;
    try {
      const { url, events, label } = req.body as { url: string; events?: string[]; label?: string };
      const sub = await createSubscription({
        apiKeyHash: ownerKey(req),
        url,
        events: events as any,
        label,
      });

      res.status(201).json({
        id: sub.id,
        url: sub.url,
        secret: sub.secret,
        eventsFilter: sub.eventsFilter,
        label: sub.label,
        status: sub.status,
        createdAt: sub.createdAt,
        _notice: 'SAVE THIS SECRET. It is required to verify webhook signatures and is shown only once.',
        _signing: {
          header: 'Ritkey-Signature',
          scheme: 't=<unix_timestamp>,v1=<hex_hmac_sha256>',
          signedPayload: '<unix_timestamp>.<raw_request_body>',
          algorithm: 'HMAC-SHA256',
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * GET /webhooks — List my subscriptions
   */
  app.get('/webhooks', authMiddleware, (req, res) => {
    if (!requireAuthMode(req, res)) return;
    const subs = listSubscriptions(ownerKey(req));
    res.json({ subscriptions: subs, count: subs.length });
  });

  /**
   * GET /webhooks/events — List supported event types
   */
  app.get('/webhooks/events', authMiddleware, (_req, res) => {
    res.json({
      eventTypes: ALL_EVENT_TYPES,
      wildcard: '*',
      description: 'Use "*" to subscribe to all events, or list specific types.',
    });
  });

  /**
   * GET /webhooks/:id — Get a subscription
   */
  app.get('/webhooks/:id', authMiddleware, (req, res) => {
    if (!requireAuthMode(req, res)) return;
    const sub = getSubscription(param(req.params.id));
    if (!sub || sub.apiKeyHash !== ownerKey(req)) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }
    res.json(sub);
  });

  /**
   * PATCH /webhooks/:id — Update subscription
   */
  app.patch('/webhooks/:id', authMiddleware, validate(UpdateSubSchema), async (req, res) => {
    if (!requireAuthMode(req, res)) return;
    try {
      const updated = await updateSubscription(
        param(req.params.id),
        ownerKey(req),
        req.body as any
      );
      if (!updated) {
        res.status(404).json({ error: 'Subscription not found' });
        return;
      }
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * DELETE /webhooks/:id — Remove subscription
   */
  app.delete('/webhooks/:id', authMiddleware, (req, res) => {
    if (!requireAuthMode(req, res)) return;
    const ok = deleteSubscription(param(req.params.id), ownerKey(req));
    if (!ok) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }
    res.status(204).end();
  });

  /**
   * POST /webhooks/:id/test — Fire a webhook.test event to THIS subscription only.
   *
   * H6: We bypass emitEvent's fanout and enqueue a single delivery directly
   * for this subscription so other tenants don't see our test event.
   */
  app.post('/webhooks/:id/test', authMiddleware, async (req, res) => {
    if (!requireAuthMode(req, res)) return;
    const sub = getSubscription(param(req.params.id));
    if (!sub || sub.apiKeyHash !== ownerKey(req)) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    const eventId = randomUUID();
    const event = {
      id: eventId,
      type: 'webhook.test' as const,
      timestamp: new Date().toISOString(),
      walletId: null,
      data: { message: `Test event for subscription ${sub.id}` },
    };

    const db = getDb();
    db.prepare(
      `INSERT INTO events (id, type, wallet_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(eventId, event.type, null, JSON.stringify(event), event.timestamp);

    db.prepare(
      `INSERT INTO webhook_deliveries (
        id, subscription_id, event_id, url, payload,
        status, attempts, next_attempt_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', 0, datetime('now'), datetime('now'))`
    ).run(randomUUID(), sub.id, eventId, sub.url, JSON.stringify(event));

    // Trigger delivery immediately so the test isn't gated by poll interval.
    void processPendingDeliveries();

    res.json({
      message: 'Test event enqueued for this subscription only',
      eventId,
      checkDeliveries: `GET /webhooks/${sub.id}/deliveries`,
    });
  });

  /**
   * GET /webhooks/:id/deliveries — Recent delivery attempts
   */
  app.get('/webhooks/:id/deliveries', authMiddleware, (req, res) => {
    if (!requireAuthMode(req, res)) return;
    const sub = getSubscription(param(req.params.id));
    if (!sub || sub.apiKeyHash !== ownerKey(req)) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }
    const limit = parseInt(req.query.limit as string) || 50;
    const deliveries = listDeliveries(sub.id, limit);
    res.json({ deliveries, count: deliveries.length });
  });

  /**
   * GET /events — Recent events (debugging)
   */
  app.get('/events', authMiddleware, (req, res) => {
    if (!requireAuthMode(req, res)) return;
    const walletId = req.query.walletId as string | undefined;
    const eventType = req.query.type as any;
    const limit = parseInt(req.query.limit as string) || 50;

    const events = listEvents({ walletId, eventType, limit });
    res.json({ events, count: events.length });
  });
}
