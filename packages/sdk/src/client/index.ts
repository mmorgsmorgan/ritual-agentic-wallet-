/**
 * Top-level RitkeyClient.
 *
 * Glues the transport to per-resource clients. Apps should construct one
 * client and reuse it.
 *
 *   const client = new RitkeyClient({
 *     baseUrl: 'https://ritkey.example.com',
 *     apiKey: process.env.RITKEY_API_KEY,
 *   });
 *
 *   const wallet = await client.wallets.create({ label: 'agent-7' });
 *   const hook = await client.webhooks.create({ url: 'https://app/hook' });
 *   const stop = client.events.subscribe({ onEvent: (e) => log(e) });
 */

import { HttpTransport } from '../transport.js';
import { WalletsClient } from './wallets.js';
import { WebhooksClient } from './webhooks.js';
import { AlertsClient } from './alerts.js';
import { EventsClient } from '../events/poller.js';
import type { RitkeyClientConfig } from '../types.js';

export class RitkeyClient {
  /** Wallet operations. */
  readonly wallets: WalletsClient;
  /** Webhook subscription management. */
  readonly webhooks: WebhooksClient;
  /** Alert rule management. */
  readonly alerts: AlertsClient;
  /** Event polling. */
  readonly events: EventsClient;

  constructor(config: RitkeyClientConfig) {
    const http = new HttpTransport(config);
    this.wallets = new WalletsClient(http);
    this.webhooks = new WebhooksClient(http);
    this.alerts = new AlertsClient(http);
    this.events = new EventsClient(http);
  }
}
