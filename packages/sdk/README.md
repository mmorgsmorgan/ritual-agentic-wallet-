# @ritkey/sdk

TypeScript SDK for Ritkey — the MPC wallet service for AI agents on Ritual Chain.

```bash
npm install @ritkey/sdk
```

Zero runtime dependencies. Works in Node 18+ and modern browsers / edge runtimes (Cloudflare Workers, Vercel, Deno).

## Quick start

```ts
import { RitkeyClient } from '@ritkey/sdk';

const client = new RitkeyClient({
  baseUrl: 'https://ritkey.example.com',
  apiKey: process.env.RITKEY_API_KEY,
});

// Create a wallet (Shamir 2-of-3 threshold). Save the shards — shown once.
const wallet = await client.wallets.create({ label: 'agent-7' });
console.log(wallet.address);
console.log('agent shard:', wallet.agentShard);
console.log('backup shard:', wallet.backupShard);

// Sign + broadcast a transaction.
const tx = await client.wallets.send({
  walletId: wallet.walletId,
  agentShard: wallet.agentShard,
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
  value: '0.01',
});
console.log(tx.hash, tx.explorer);
```

## Webhooks

Register a webhook to receive real-time events. Save the `secret` — Ritkey shows it only once.

```ts
const hook = await client.webhooks.create({
  url: 'https://yourapp.com/ritkey-hook',
  events: ['tx.sent', 'wallet.funded', 'key.exported'],
  label: 'production',
});

// Save somewhere safe:
//   hook.id, hook.secret

// Fire a test delivery to verify connectivity:
await client.webhooks.test(hook.id);
```

### Verify deliveries on your receiver

In your webhook handler, use `verifyWebhook` to check the HMAC signature and parse the event.

**IMPORTANT**: pass the EXACT raw bytes Ritkey sent. If your framework JSON-parses before you see the body, the HMAC will mismatch. Use a raw body reader on the webhook route.

```ts
import express from 'express';
import { verifyWebhook, isEvent } from '@ritkey/sdk';

const app = express();

app.post(
  '/ritkey-hook',
  express.raw({ type: 'application/json' }), // raw bytes
  (req, res) => {
    const result = verifyWebhook(
      req.body, // Buffer
      req.headers['ritkey-signature'],
      process.env.RITKEY_WEBHOOK_SECRET
    );

    if (!result.ok) {
      return res.status(401).send(result.reason);
    }

    // Type-narrow on the event type:
    if (isEvent(result.event, 'tx.sent')) {
      console.log('tx hash:', result.event.data.hash);
    } else if (isEvent(result.event, 'key.exported')) {
      console.log('SECURITY: key exported for', result.event.data.address);
    }

    // Always 200 quickly — Ritkey retries on non-2xx.
    res.status(200).end();
  }
);
```

The verifier:
- Validates HMAC-SHA256 over `<timestamp>.<rawBody>` using your secret
- Rejects timestamps outside a 5-minute tolerance window (replay protection)
- Uses `timingSafeEqual` (no early-exit / timing leaks)
- Returns a typed event object on success

### Idempotency

Deliveries can repeat if your endpoint times out but actually succeeded. Use `Ritkey-Event-Id` as the dedup key:

```ts
const eventId = req.headers['ritkey-event-id'];
if (await alreadyProcessed(eventId)) {
  return res.status(200).end();
}
```

## Events (polling)

For environments where running a public HTTPS endpoint is impractical (CLIs, scripts, local dev), use the polling client:

```ts
const stop = client.events.subscribe({
  types: ['tx.sent', 'wallet.funded'],
  intervalMs: 3000,
  onEvent: (event) => {
    console.log(event.type, event.data);
  },
  onError: (err) => console.error(err),
});

// Later:
stop();
```

Polling burns more API quota than webhooks. Use webhooks for production.

## Import an existing wallet

Bring your MetaMask / Rabby / hardware-wallet key under Ritkey management:

```ts
const wallet = await client.wallets.import_({
  privateKey: '0x562f22a32039901eac...',
  label: 'imported-from-metamask',
});

// Same address as MetaMask, now manageable through Ritkey.
console.log(wallet.address);
```

## Export a key

If you need full self-custody (back to MetaMask, hardware wallet, etc.):

```ts
const { privateKey, status } = await client.wallets.exportKey({
  walletId: wallet.walletId,
  agentShard: wallet.agentShard,
});

console.log('private key for MetaMask import:', privateKey);
console.log('wallet status:', status); // 'archived'
```

After export, the wallet is **archived** in Ritkey. `/send`, `/sign`, `/deposit-ritual`, and a re-export all return 403. Sweep funds to a fresh wallet if you want to keep using Ritkey.

## Errors

Every error from the SDK is a `RitkeyError` with `status`, `code`, and the parsed response body:

```ts
import { RitkeyClient, RitkeyError } from '@ritkey/sdk';

try {
  await client.wallets.get('nope');
} catch (err) {
  if (err instanceof RitkeyError) {
    console.log(err.status); // 404
    console.log(err.code);   // optional error code from the server
    console.log(err.body);   // full server response body
  }
}
```

## Reference

### Construction

```ts
new RitkeyClient({
  baseUrl: string;        // required, no trailing slash needed
  apiKey?: string;        // required unless server is in OPEN_MODE
  fetch?: typeof fetch;   // override (e.g. for Cloudflare Workers)
  timeoutMs?: number;     // per-request timeout, default 30000
});
```

### Wallets

| Method | HTTP |
|---|---|
| `client.wallets.create(input?)` | `POST /wallets` |
| `client.wallets.import_(input)` | `POST /wallets/import` |
| `client.wallets.list()` | `GET /wallets` |
| `client.wallets.me()` | `GET /wallets/me` |
| `client.wallets.get(id)` | `GET /wallets/:id` |
| `client.wallets.balance(id)` | `GET /wallets/:id/balance` |
| `client.wallets.send(input)` | `POST /wallets/:id/send` |
| `client.wallets.sign(input)` | `POST /wallets/:id/sign` |
| `client.wallets.fund(id)` | `POST /wallets/:id/fund` |
| `client.wallets.exportKey(input)` | `POST /wallets/:id/export-key` |
| `client.wallets.sweepAndArchive(input)` | `POST /wallets/:id/sweep-and-archive` |
| `client.wallets.freeze(id)` | `POST /wallets/:id/freeze` |
| `client.wallets.unfreeze(id)` | `POST /wallets/:id/unfreeze` |

### Webhooks

| Method | HTTP |
|---|---|
| `client.webhooks.create(input)` | `POST /webhooks` |
| `client.webhooks.list()` | `GET /webhooks` |
| `client.webhooks.listEventTypes()` | `GET /webhooks/events` |
| `client.webhooks.get(id)` | `GET /webhooks/:id` |
| `client.webhooks.update(id, patch)` | `PATCH /webhooks/:id` |
| `client.webhooks.delete(id)` | `DELETE /webhooks/:id` |
| `client.webhooks.test(id)` | `POST /webhooks/:id/test` |
| `client.webhooks.listDeliveries(id)` | `GET /webhooks/:id/deliveries` |

### Events

| Method | Behaviour |
|---|---|
| `client.events.list(opts?)` | One-shot fetch of recent events. |
| `client.events.subscribe(opts)` | Polls `/events`, calls `onEvent` per new event. Returns a stop function. |

### Verification helper

| Function | Use |
|---|---|
| `verifyWebhook(rawBody, sigHeader, secret, opts?)` | Verify a webhook delivery on your receiver. Returns `{ ok, event } \| { ok: false, reason }`. |
| `isEvent(event, type)` | Type-narrowing helper for verified events. |
