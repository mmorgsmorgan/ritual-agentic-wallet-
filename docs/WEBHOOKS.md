# Ritkey Webhooks

Subscribe to wallet events and receive real-time HTTP notifications. The signing scheme matches Stripe's so any HMAC-SHA256 verification library works.

---

## Quick start

```bash
# 1. Register a subscription
curl -X POST http://localhost:3000/webhooks \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://yourapp.com/ritkey/hook",
    "events": ["*"],
    "label": "production"
  }'

# Response includes the signing secret (shown only once):
{
  "id": "...",
  "secret": "whsec_abc123...",   ← save this
  "url": "https://...",
  ...
}

# 2. Trigger a test delivery
curl -X POST http://localhost:3000/webhooks/{id}/test \
  -H 'Authorization: Bearer YOUR_API_KEY'

# 3. Inspect deliveries
curl http://localhost:3000/webhooks/{id}/deliveries \
  -H 'Authorization: Bearer YOUR_API_KEY'
```

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/webhooks` | Register a subscription |
| `GET` | `/webhooks` | List your subscriptions |
| `GET` | `/webhooks/events` | List supported event types |
| `GET` | `/webhooks/:id` | Get one subscription |
| `PATCH` | `/webhooks/:id` | Update url/events/label/status |
| `DELETE` | `/webhooks/:id` | Delete subscription |
| `POST` | `/webhooks/:id/test` | Fire a test event |
| `GET` | `/webhooks/:id/deliveries` | Recent delivery attempts (debugging) |
| `GET` | `/events` | Recent events (debugging) |

---

## Event types

Subscribe to `["*"]` for everything, or specific types:

| Event | When it fires |
|---|---|
| `wallet.created` | New threshold wallet created |
| `wallet.imported` | External private key imported |
| `wallet.funded` | Faucet drip claimed |
| `wallet.frozen` | Wallet frozen |
| `wallet.unfrozen` | Wallet unfrozen |
| `wallet.archived` | Wallet archived |
| `wallet.swept` | Funds swept and archived |
| `tx.sent` | Transaction broadcast |
| `message.signed` | Off-chain message signed |
| `ritual.deposited` | Funds deposited to RitualWallet escrow |
| `key.exported` | Private key exported (⚠️ critical) |
| `webhook.test` | Manually triggered test event |

---

## Signature verification

Every delivery includes a header:

```
Ritkey-Signature: t=<unix_timestamp>,v1=<hex_hmac_sha256>
```

To verify:

```js
import { createHmac, timingSafeEqual } from 'crypto';

function verify(rawBody, signatureHeader, secret) {
  const [t, v1] = signatureHeader.split(',').map((p) => p.split('=')[1]);

  // Reject signatures older than 5 minutes
  const ageSec = Math.floor(Date.now() / 1000) - parseInt(t);
  if (ageSec > 300) return false;

  const signed = `${t}.${rawBody}`;
  const expected = createHmac('sha256', secret).update(signed).digest('hex');

  return timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
}
```

Plus you also get:

```
Ritkey-Event-Id: <event_uuid>           ← use for idempotency
Ritkey-Delivery-Id: <delivery_uuid>     ← retries reuse the same event id but get new delivery ids
Ritkey-Attempt: <n>                     ← 1 for first try, n for retries
```

---

## Retry policy

Failed deliveries (non-2xx, network error, timeout) are retried with exponential backoff:

```
attempt 1 → immediate
attempt 2 → +5s
attempt 3 → +10s
attempt 4 → +20s
attempt 5 → +40s
attempt 6 → +80s
attempt 7 → +160s
attempt 8 → +320s
(then marked dead)
```

After 10 consecutive failures across all deliveries, the subscription is auto-disabled. Re-enable via `PATCH /webhooks/:id { "status": "active" }`.

---

## Idempotency

Treat `Ritkey-Event-Id` as the deduplication key. The same event may be delivered multiple times if your endpoint times out but actually succeeded.

```js
if (await alreadyProcessed(headers['ritkey-event-id'])) {
  return res.status(200).end();
}
```

---

## Local development

By default webhooks must use HTTPS in production. For local dev, set:

```
NODE_ENV=development
# or
RITKEY_ALLOW_INSECURE_WEBHOOKS=true
```

This lets you register `http://localhost:...` URLs.

---

## What just shipped

- **Event system** — every wallet activity becomes a persisted event
- **Subscription management** — register/list/update/delete via REST
- **HMAC-signed delivery** — Stripe-compatible signing scheme
- **Exponential backoff retries** — 8 attempts over ~20 minutes
- **Auto-disable on persistent failure** — 10 consecutive failures = paused
- **Delivery log** — debug exactly what happened to each delivery
- **Event filter** — wildcard or specific event types per subscription

**10/10 end-to-end tests passing.**
