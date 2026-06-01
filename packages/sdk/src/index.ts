/**
 * @ritkey/sdk — TypeScript SDK for Ritkey
 *
 * Public surface:
 *   - RitkeyClient: wallet, webhook, events operations
 *   - verifyWebhook: receiver-side HMAC verification helper
 *   - isEvent: type narrower for verified events
 *   - All public types
 */

export { RitkeyClient } from './client/index.js';
export { WalletsClient } from './client/wallets.js';
export { WebhooksClient } from './client/webhooks.js';
export { AlertsClient } from './client/alerts.js';
export { EventsClient } from './events/poller.js';
export { verifyWebhook, isEvent } from './verify/index.js';
export type { VerifyOptions, VerifyResult } from './verify/index.js';
export type { SubscribeOptions, StopFn } from './events/poller.js';
export * from './types.js';
