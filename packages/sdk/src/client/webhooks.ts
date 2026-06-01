/**
 * Webhook subscription management.
 *
 *   POST   /webhooks                       create()
 *   GET    /webhooks                       list()
 *   GET    /webhooks/events                listEventTypes()
 *   GET    /webhooks/:id                   get(id)
 *   PATCH  /webhooks/:id                   update(id, ...)
 *   DELETE /webhooks/:id                   delete(id)
 *   POST   /webhooks/:id/test              test(id)
 *   GET    /webhooks/:id/deliveries        listDeliveries(id)
 */

import type { HttpTransport } from '../transport.js';
import type {
  CreatedWebhook,
  WebhookSubscription,
  CreateWebhookInput,
  UpdateWebhookInput,
  DeliveryLogEntry,
  EventType,
} from '../types.js';

export class WebhooksClient {
  constructor(private readonly http: HttpTransport) {}

  /** Create a new webhook subscription. Response includes `secret` — save it. */
  async create(input: CreateWebhookInput): Promise<CreatedWebhook> {
    return this.http.request<CreatedWebhook>('POST', '/webhooks', input);
  }

  async list(): Promise<{ subscriptions: WebhookSubscription[]; count: number }> {
    return this.http.request<{ subscriptions: WebhookSubscription[]; count: number }>(
      'GET',
      '/webhooks'
    );
  }

  async listEventTypes(): Promise<{
    eventTypes: EventType[];
    wildcard: '*';
    description: string;
  }> {
    return this.http.request('GET', '/webhooks/events');
  }

  async get(subscriptionId: string): Promise<WebhookSubscription> {
    return this.http.request<WebhookSubscription>(
      'GET',
      `/webhooks/${encodeURIComponent(subscriptionId)}`
    );
  }

  async update(
    subscriptionId: string,
    patch: UpdateWebhookInput
  ): Promise<WebhookSubscription> {
    return this.http.request<WebhookSubscription>(
      'PATCH',
      `/webhooks/${encodeURIComponent(subscriptionId)}`,
      patch
    );
  }

  async delete(subscriptionId: string): Promise<void> {
    await this.http.request<void>(
      'DELETE',
      `/webhooks/${encodeURIComponent(subscriptionId)}`
    );
  }

  /**
   * Fire a `webhook.test` event to this subscription only.
   * Useful for verifying connectivity and HMAC verification on your receiver.
   */
  async test(subscriptionId: string): Promise<{ message: string; eventId: string }> {
    return this.http.request(
      'POST',
      `/webhooks/${encodeURIComponent(subscriptionId)}/test`
    );
  }

  async listDeliveries(
    subscriptionId: string,
    opts?: { limit?: number }
  ): Promise<{ deliveries: DeliveryLogEntry[]; count: number }> {
    const qs = opts?.limit ? `?limit=${opts.limit}` : '';
    return this.http.request(
      'GET',
      `/webhooks/${encodeURIComponent(subscriptionId)}/deliveries${qs}`
    );
  }
}
