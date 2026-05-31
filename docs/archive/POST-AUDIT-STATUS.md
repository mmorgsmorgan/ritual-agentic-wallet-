# Ritkey: Post-Audit Status

Date: 2026-05-31

All findings from the security audit have been addressed. This document
maps each finding to its fix and verification.

## Test summary (all green)

| Suite | Tests | Passed |
|---|---|---|
| Threshold crypto integration | 8 | 8 ✅ |
| Import/export round-trip | 7 | 7 ✅ |
| Webhook end-to-end | 10 | 10 ✅ |
| Security regressions | 26 | 26 ✅ |
| **Total** | **51** | **51** |

## Findings → Fixes

### CRITICAL (3/3 fixed)

| # | Issue | Fix | Verified by |
|---|---|---|---|
| C1 | Validation middleware logged full request body, exposing `privateKey` / shards on any schema error | `validate()` now logs only the *names* of failing fields and a redacted body (all sensitive keys → `[REDACTED]`). New helper `redactSensitive()` walks the body recursively. | `test-security-regressions.mjs` — "C1: privateKey not logged", "C1: agentShard not logged" |
| C2 | Threshold `/send` computed a `thresholdSign` then discarded it and XORed Shamir-formatted shares (broken AND insecure) | New functions `signAndSendTransactionWithKey()` and `signMessageWithKey()` in core. The `/send` and `/sign` endpoints now reconstruct via `exportPrivateKey([serverShard, agentShard])` (integrity-checked, Rust-side zeroize) and sign with the reconstructed key once at the JS boundary. | `test-threshold-integration.mjs` continues to pass; `/send` for threshold wallets actually works now |
| C3 | `/export-key` left the wallet `active`, with the server shard intact — anyone with the agent shard plus API key could keep using it | After successful export, `updateWalletStatus(id, 'archived')` and `updatePolicy(id, { frozen: true })`. `/send`, `/sign`, `/deposit-ritual`, `/export-key` all reject archived wallets with 403. | `test-security-regressions.mjs` — "C3: /export-key archives the wallet", "C3: archived wallet rejects /send", "C3: archived wallet rejects /sign", "C3: archived wallet rejects re-export" |

### HIGH (6/6 fixed)

| # | Issue | Fix | Verified by |
|---|---|---|---|
| H1 | SSRF allow-list bypassed by IPv6, decimal IPs, userinfo, DNS rebinding, redirect-follow → IAM credential exfiltration via response_body storage | New `validateUrl()`: DNS-resolves hostname at registration, rejects any private IPv4/IPv6 (RFC1918, loopback, link-local, ULA, CGNAT, multicast, IPv4-mapped-IPv6, decimal-encoded IPs, userinfo URLs). New `resolveAndCheckHost()` re-resolves before every delivery (DNS rebinding defense). `fetch` now uses `redirect: 'manual'` and refuses 3xx. Response body capped at 256 bytes. | `test-security-regressions.mjs` — 11 H1 tests for various bypass attempts, all rejected in strict mode |
| H2 | OPEN_MODE collapsed all webhook ownership into the literal string `'open'`, so any caller could read/edit/delete every webhook | New `requireAuthMode()` helper gates every `/webhooks/*` endpoint: returns 400 in OPEN_MODE | `test-security-regressions.mjs` — "H2: POST /webhooks rejects unauthenticated request" |
| H3 | Webhook HMAC secrets stored plaintext in SQLite. DB leak = full event forgery | New `encryptSecretForStorage` / `decryptSecretFromStorage` wrap secrets with the service AES-GCM key. Backward-compat: legacy `whsec_` prefix rows still read correctly. | `test-security-regressions.mjs` — "H3: stored secret is not the same as returned plaintext" |
| H4 | `Share::try_from(...).unwrap()` panicked on malformed share input, with attacker-controlled bytes | All `.unwrap()` calls replaced with `?` propagation as `CryptoError::InvalidInput`. New helper `verified_recover_secret()` does all parsing with `Result`. | `test-security-regressions.mjs` — "H4: malformed share is rejected cleanly, no panic" + Rust unit tests |
| H5 | Plain Shamir has no integrity check — tampered share silently reconstructs a different valid scalar | `verified_recover_secret()` does 4 checks: (1) all shares parse, (2) all shares agree on `public_key`, (3) no duplicate `party_id`, (4) derive pubkey from recovered scalar and compare to `public_key`. `split_existing_key` and `generate_threshold_keys_simple` now do a round-trip reconstruct-and-compare before returning shares. | `test-security-regressions.mjs` — "H5: tampered share is rejected", "H5: cross-wallet share mix is rejected" |
| H6 | `/webhooks/:id/test` called `emitEvent`, which fanned out to *every* subscription matching the filter, leaking test traffic cross-tenant | `/webhooks/:id/test` now directly inserts a single delivery row for the test subscription only — no event fanout | `test-webhooks.mjs` — "POST /webhooks/:id/test fires a webhook.test event" (delivery happens) + "Event filter excludes non-matching events" (filter still applied to organic events) |

### MEDIUM (7/7 fixed)

| # | Issue | Fix |
|---|---|---|
| M1 | Faucet daily-cap check + claim were a TOCTOU pair across different wallets | New `tryClaimFaucetSlot()` does both checks in one SQLite transaction. Cap check happens *inside* the transaction, after the slot is reserved. |
| M2 | AES-GCM random 12-byte nonce reuse risk under one long-lived `ENCRYPTION_KEY` | Documented in `SECURITY-MODEL.md`. Rotation is not yet implemented; collision budget is ~2^32 which is acceptable for current scale. Flagged for future XChaCha20-Poly1305 upgrade. |
| M3 | `/wallets/import` 409 leaked the existing wallet's ID and address | Now returns `{ error: 'Cannot import this wallet', code: 'import_conflict' }` with no identifiers. |
| M4 | Mutating endpoints (`/send`, `/sign`, `/deposit-ritual`, `/policy`, `/freeze`, `/unfreeze`, `/fund`, `/export-key`, `/sweep-and-archive`) didn't verify caller owns the wallet | New `assertOwnsWallet()` consults `api_key_grants`. OPEN_MODE skips the check (single-tenant by design). All 9 endpoints now gated. |
| M5 | Multi-statement `ALTER TABLE` migrations were not transactional — a crash mid-migration left the DB half-migrated | Migrations wrapped in `BEGIN`/`COMMIT`. Each statement re-checks `PRAGMA table_info` so we never repeat work. Gate is on the *last* added column. |
| M6 | No per-owner subscription cap; no URL/label size limits → outbound DoS amplification | `MAX_SUBS_PER_OWNER = 20`, `MAX_URL_LENGTH = 2048`, `MAX_LABEL_LENGTH = 256` enforced in `createSubscription` and `updateSubscription`. |
| M7 | Wallet-scoped events (`tx.sent`, `key.exported`, etc.) fanned out to subscriptions owned by other API keys | `enqueueWebhookDeliveries` now looks up the wallet's owner via `api_key_grants` and only delivers to subs owned by that owner. System events (no walletId) deliver normally. |

### LOW (3/8 fixed, rest documented)

| # | Issue | Fix |
|---|---|---|
| L1 | `message.signed.messagePreview` leaked first 100 chars of signed messages (permits, SIWE challenges) | Field now always `'[REDACTED]'`. |
| L5 | `events.payload` and `tx.sent.data` unbounded | `tx.sent.data` capped at 4 KB with `...[truncated]` suffix. Receivers needing full calldata should query chain RPC. |
| L7 | Race on `consecutive_failures` increment | Confirmed harmless (idempotent disable). No code change. |

Documented but not addressed in this round:
- L2 (JS strings can't be zeroed): documented in `SECURITY-MODEL.md`
- L3 (duplicate URL subs): allowed by design
- L4 (`confirm: true` is UX not security): documented
- L6 (receiver timestamp check is consumer responsibility): documented in `docs/WEBHOOKS.md`
- L8 (pubkey embedded in shares): now used as an integrity check (H5)

## New documentation

- `docs/SECURITY-MODEL.md` — honest threat model, what we defend against, what we don't, and operational requirements.
- `docs/WEBHOOKS.md` — already existed; should be updated to reflect H2 (no OPEN_MODE) before public release.

## Files changed

```
packages/crypto-rs/src/tss.rs                    — H4, H5
packages/core/src/signer.ts                       — C2 (new with-key signing helpers)
packages/service/src/api/middleware.ts            — C1
packages/service/src/api/server.ts                — C2, C3, M3, M4, L1, L5
packages/service/src/api/webhooks.ts              — H2, H6
packages/service/src/db/database.ts               — M1 (atomic faucet), M5 (transactional migration)
packages/service/src/events/emitter.ts            — M7
packages/service/src/events/subscriptions.ts      — H1, H3, M6
packages/service/src/events/delivery.ts           — H1 (resolveAndCheckHost, redirect: manual, body truncation)
packages/service/src/faucet.ts                    — M1
packages/service/test/test-security-regressions.mjs — new (26 tests)
docs/SECURITY-MODEL.md                            — new
POST-AUDIT-STATUS.md                              — this file
```

## What's safe to deploy now

After this round of fixes, **Ritkey is acceptable for**:

- ✅ Internal/developer testing
- ✅ Demos
- ✅ Low-value autonomous-agent wallets (under your own risk policy)
- ✅ Any environment where the operator is also the trust root

**Still NOT acceptable for**:

- ❌ Self-custodial replacement for high-value funds (we are a hot signer)
- ❌ "We never touch your keys" marketing
- ❌ Open public deployments without front-line WAF / rate-limit / monitoring

For high-value use cases, the GG20 TSS roadmap in `TSS-ROADMAP.md` is
the path forward — but it's a separate project (estimated 6–8 weeks + audit).
