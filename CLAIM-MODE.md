# Enabling Per-Visitor Wallets (Claim Mode)

By default the MCP service runs in **legacy bearer mode** — one shared
`MCP_BEARER_TOKEN` that maps to one wallet on the service. Fine for a
single user / demo.

**Claim mode** turns the MCP service into a multi-tenant gateway:

- Each visitor to the landing page calls `POST /claim` once
- The MCP service provisions a fresh wallet-service user (P-256 keypair)
  via the admin user
- The bearer it returns to the visitor maps to that unique user
- Every MCP request signed with that bearer is forwarded to the wallet
  service with the user's keys → **each visitor gets their own wallet**

This doc walks you through turning it on.

---

## Prerequisites

- Wallet service running (see `RAILWAY-DEPLOY.md`)
- MCP service running and connected to the wallet service
- A persistent volume mounted at `/data` on **both** services (the MCP
  service needs one for the claims SQLite DB)

---

## Step 1 — Create an admin user on the wallet service

The admin user is what the MCP service uses to call `POST /users/` when
provisioning a new visitor.

In your wallet-service repo, run the included setup script. Easiest path:
Railway shell on the wallet service.

```bash
# From a one-shot shell on the wallet service:
npm run -w @ritkey/service setup-admin
```

It will prompt:

```
Admin username: ritkey-admin
API key name: primary-key
```

Output:

```
✓ Admin user created
✓ Saving credentials to admin-keys.json

PUBLIC KEY  (paste into MCP service ADMIN_PUBLIC_KEY env var):
03ab12...64-hex-chars-total...

PRIVATE KEY (paste into MCP service ADMIN_PRIVATE_KEY env var):
{"kty":"EC","crv":"P-256","x":"…","y":"…","d":"…"}
```

**Copy both. They are shown only once.** Save them to a password manager
right now.

> ⚠️ The private key is JWK JSON. When you paste it into Railway it must
> stay on one line — Railway env var values are single-line. The JWK
> already has no newlines, so just paste verbatim.

---

## Step 2 — Add the persistent volume on the MCP service

In Railway → your MCP service → **Settings → Volumes → New Volume**:

- **Mount path:** `/data`
- **Size:** 1 GB

Without this, the claims SQLite DB lives on the ephemeral container
disk and **every visitor loses their wallet on the next deploy**.

---

## Step 3 — Set env vars on the MCP service

**Settings → Variables**, add:

| Key | Value |
|---|---|
| `ENABLE_CLAIM` | `true` |
| `ADMIN_PUBLIC_KEY` | the 66-hex-char public key from step 1 |
| `ADMIN_PRIVATE_KEY` | the JWK JSON string from step 1 |
| `CLAIMS_DB_PATH` | `/data/claims.db` *(default — set explicitly to be safe)* |
| `CLAIM_RATE_PER_HOUR` | `10` *(per-IP cap; tune as you like)* |

Keep `MCP_BEARER_TOKEN` and `RITKEY_API_KEY` for the legacy/admin path
during the transition. You can drop `RITKEY_API_KEY` once everyone is
on claimed bearers.

---

## Step 4 — Deploy and verify

Railway will redeploy on the env-var change. After it's up:

```bash
# Health endpoint reports claim mode + the issued count
curl https://your-mcp.up.railway.app/health
# {"status":"ok","target":"...","sessions":0,"claims_enabled":true,"claims_issued":0}

# Mint a test bearer
curl -X POST https://your-mcp.up.railway.app/claim
# {"bearer":"<64 hex>","endpoint":"https://.../mcp","note":"Save this bearer..."}

# Use that bearer to talk to the MCP — full MCP handshake works,
# and create_wallet returns a wallet that belongs ONLY to that bearer
```

---

## Step 5 — Frontend picks it up automatically

The landing page (`packages/web`) already calls `POST /claim` on first
visit when it doesn't have a claimed bearer in localStorage. The
generated config snippet shows the visitor's personal bearer pre-filled.

The badge above the config card flips from
**"Provisioning your personal wallet identity…"** to
**"Your personal wallet is ready"** when the claim succeeds, or
falls back to **"Using shared demo wallet"** when claim mode is off.

---

## Rolling back

If something breaks: set `ENABLE_CLAIM=false` in Railway and the MCP
service goes back to legacy bearer mode. Already-issued personal
bearers will start returning 401 — keep them paired with `ENABLE_CLAIM=true`
or warn users you're disabling the feature.

---

## Notes

- Claim mode does NOT prevent the same visitor from claiming multiple
  bearers. Rate limit is per-IP per-hour, which slows abuse without
  requiring accounts.
- Provisioned users on the wallet service are not garbage-collected.
  Each claim creates a row in the wallet-service `users` table forever.
  A future janitor could prune unused users after N days.
- The admin private key in the MCP service has full create-user
  privileges. If the MCP service is compromised, attackers can mint
  unlimited users on your wallet service. Rotate the admin key if you
  suspect compromise.
