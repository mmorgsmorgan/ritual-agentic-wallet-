# Ritkey Security Model — Honest Assessment

> Last updated: 2026-05-31 (post-audit)

This document describes what Ritkey protects against and — more importantly —
what it does not. Read this before deploying to a real network.

## Threat model

### What Ritkey defends against
- **Curious server operator** with read-only DB access: server shard is
  AES-256-GCM encrypted; cannot recover keys without `ENCRYPTION_KEY`.
- **Curious agent owner** with their own shard: cannot sign without the
  server's cooperation (or the backup share).
- **Tampered single share**: integrity-checked Shamir recovery (H5)
  detects share mismatch by deriving public key after reconstruction.
- **API-key compromise**: per-API-key wallet binding (Sybil layer B),
  ownership checks on mutating endpoints (M4), daily faucet cap (Layer F).
- **Webhook receiver spoofing**: HMAC-SHA256 signing on every delivery.
- **Server-side request forgery via webhook URLs**: hostname is resolved
  at registration AND at every delivery; private IPs / IPv6 ULA / link-local
  rejected; redirects refused (H1).
- **Cross-tenant event leak**: wallet-scoped events only deliver to webhook
  subscriptions owned by the wallet's API key (M7).
- **Replay of webhook deliveries**: every event has a unique `id`; receivers
  should de-duplicate on `Ritkey-Event-Id`.

### What Ritkey does NOT defend against (honest list)

| # | Threat | Why it's not defended |
|---|---|---|
| 1 | **Server compromise with code execution** | Attacker can read `ENCRYPTION_KEY` from env, decrypt all shards, and sign anything. Server is a hot signer in our threshold scheme. |
| 2 | **Memory dump of the Node process during signing** | The reconstructed private key briefly exists in Rust heap (zeroized on drop) and in V8 heap (cannot be zeroed — V8 strings are immutable). A heap dump captured at the right instant exposes the key. |
| 3 | **Persistent advanced attacker on the host** | Logs, swap, ptrace, /proc/<pid>/mem all expose secrets. We do NOT mlock pages. |
| 4 | **The wallet's owner themselves** — once `/wallets/:id/export-key` is called, Ritkey can no longer guarantee anything about the wallet. The owner has full custody and the wallet is archived. |
| 5 | **A subscriber receiving spoofed events** if `ENCRYPTION_KEY` leaks (webhook secrets are encrypted with it). Mitigation: rotate `ENCRYPTION_KEY` quickly and re-issue all secrets. |
| 6 | **Real distributed-trust TSS** — we use Shamir secret sharing, which reconstructs the key. True GG20/CGGMP21 TSS never reconstructs. We chose this trade-off to keep the agent UX as "one shard → sign", consistent with Turnkey's pre-Nitro model. See `TSS-ROADMAP.md`. |

### What this means in practice

**Acceptable use:**
- Test wallets, faucet flows, demos.
- Small-value autonomous-agent wallets where the operational simplicity
  outweighs the residual server-trust requirement.
- Wallets where the user can always export to MetaMask if they want
  unilateral control.

**NOT acceptable use:**
- Self-custodial wallet replacement for high-value funds.
- "We never touch your keys" marketing — we DO briefly touch them
  during signing. We just zeroize quickly.

## Cryptography choices

| Primitive | Library | Notes |
|---|---|---|
| Key splitting | `sharks` (Shamir over GF(256)) | 2-of-3 default. Integrity check derives pubkey post-recovery. |
| ECDSA | `secp256k1` | Standard. |
| Encryption at rest | AES-256-GCM, random 12-byte nonce | See nonce-collision note below. |
| Webhook signing | HMAC-SHA256, t+v1 scheme | Stripe-compatible signing payload. |

### AES-GCM random nonce — collision budget

We use random 12-byte nonces under a single long-lived `ENCRYPTION_KEY`.
Birthday bound for collision is ~2^32 messages **per key**. We are well
under this in any realistic deployment, but operators handling >10M
wallets should rotate `ENCRYPTION_KEY` periodically or upgrade to
XChaCha20-Poly1305 (24-byte nonces).

## Operational requirements

For production deployment:

1. **`ENCRYPTION_KEY` must be 32 bytes of crypto-strong randomness**, stored
   outside the application code (KMS, sealed secret, etc.). Loss = all
   server shards become unrecoverable. Compromise = all stored shards
   readable. We do NOT support key rotation yet.

2. **`API_KEY` must be set** (no OPEN_MODE in production). Webhook endpoints
   refuse to operate in OPEN_MODE (H2).

3. **HTTPS only** for webhook URLs in production (`NODE_ENV != development`
   and `RITKEY_ALLOW_INSECURE_WEBHOOKS != true`).

4. **Faucet daily cap** (`FAUCET_DAILY_CAP`) should be set if a faucet is
   configured. Without it, a leaked agent shard with API access can drain
   the faucet wallet.

5. **Persistent DB backups** must be encrypted at rest by the storage layer
   too — Ritkey encrypts shards/secrets but the audit log, events, and
   user metadata are plaintext.

## When to use something else

- **High-value wallets / institutional funds** → Turnkey, Fireblocks,
  Coinbase Custody. They run in TEEs (Nitro Enclaves) and have real audits.
- **Hardware-rooted security** → HSM-backed signing, or hardware wallets.
- **No-server-trust wallets** → real TSS (Sodium TSS, ZenGo's
  multi-party-ecdsa, or upgrade Ritkey to GG20).
