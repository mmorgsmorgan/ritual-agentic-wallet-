---
name: ritual-rules
description: Hard rules for any agent operating on Ritual Chain. Break these and your transactions revert.
metadata:
  type: rules
---

# Ritual Chain Rules — Hard Constraints

These are not advice. These are constraints enforced by the chain or by economic reality. Breaking them means reverted transactions, lost funds, or stranded assets. When in doubt, read the corresponding skill (`read_ritual_skill`).

## Chain identity

- **Chain ID:** 1979 (Ritual Chain).
- **Native currency:** RITUAL (18 decimals).
- **RPC:** `https://rpc.ritualfoundation.org`.
- **Explorer:** `https://explorer.ritualfoundation.org`.
- All transactions **must** use EIP-1559 fee fields (`maxFeePerGas` + `maxPriorityFeePerGas`). Legacy Type-0 transactions are rejected with RPC error `-32003`.

## RitualWallet (escrow for fees)

- **Address:** `0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948`.
- The lock is **monotonic** — new deposits only extend, never shorten. Over-locking has no downside.
- For async precompiles (HTTP/LLM/Image/Audio/Video/Sovereign Agent), the chain checks `balanceOf(EOA_signer)` at commitment time. Depositing only into a contract address is wrong for EOA-initiated calls; use `depositFor(eoaAddress, lockDuration)` from a contract or `deposit()` directly from the EOA.
- `withdraw()` reverts with `FundsLocked` until `block.number >= lockUntil(user)`.
- Sending raw RITUAL to the contract via `receive()` credits balance with **0 lock extension**.

## HTTP precompile (`0x0801`)

- The request ABI is **13 fields** in this exact order: `(address executor, bytes[] encryptedSecrets, uint256 ttl, bytes[] secretSignatures, bytes userPublicKey, string url, uint8 method, string[] headerKeys, string[] headerValues, bytes body, uint256 dkmsKeyIndex, uint8 dkmsKeyFormat, bool piiEnabled)`. Any other field count gets the tx rejected.
- `method` codes are 1–7 (GET=1, POST=2, PUT=3, DELETE=4, PATCH=5, HEAD=6, OPTIONS=7). **Method 0 is invalid** and rejected.
- `ttl` must satisfy `0 < ttl ≤ 500` (default network policy). Zero is rejected.
- URL scheme **must be `http://` or `https://`** — others are rejected at the RPC layer.
- One short-running async call per transaction. One async commitment per sender per block. To parallelize, use multiple senders.
- The output envelope is `(bytes simmedInput, bytes actualOutput)` — always unwrap before decoding the response. During simulation, `actualOutput` is `0x`.
- **Always check `errorMessage` first** in the decoded response — a settled tx can still report executor error.

## LLM precompile (`0x0802`)

- The request ABI has **30 fields** ending with the `(string,string,string)` `convoHistory` tuple. Submitting any other count returns RPC `-32602 invalid async payload`.
- `convoHistory` is **required**. If you don't have a DA-backed history, pass `('', '', '')` — the executor will error honestly rather than silently misbehave.
- Numeric params are scaled by 1000: `temperature = milli/1000`, `topP = milli/1000`, `frequencyPenalty = milli/1000`, `presencePenalty = milli/1000`.
- For reasoning models like `zai-org/GLM-4.7-FP8`, set `maxCompletionTokens >= 4096`.
- Result lives in the `PrecompileCalled(address,bytes,bytes)` event in the receipt — wrapped in the same async envelope as HTTP.
- `has_error=true` in the response still costs an executor fee (`LLM_ERROR_EXECUTOR_FEE_WEI = 0.0000005 RITUAL`).
- One async call per tx. Same per-sender-per-block limit as HTTP.

## Async lifecycle (HTTP/LLM/Image/Audio/Video/Agents)

- Two phases:
  1. **Commitment phase** — block builder simulates, creates commitment. `actualOutput` is empty.
  2. **Fulfillment phase** — executor runs off-chain in TEE; builder re-executes the deferred tx with output injected (fulfilled replay).
- During the commitment phase the receipt's status may be `success` but the `PrecompileCalled` log will have an empty `actualOutput`. **This is not failure** — it's "not done yet." Poll a few blocks later.
- Phase-1 fees (`settlePhase1Fees`) pay executor + commitment validator + inclusion validator from `RitualWallet[signer]`. Phase-2 fees pay the executor again plus the callback gas escrow.
- Callback gas escrow = `deliveryGasLimit × deliveryMaxFeePerGas + deliveryValue`, escrowed at submit time, partially refunded after.

## Sovereign Agent / Persistent Agent fee shape

- Phase-1 settlement: `0.0000005 RITUAL`.
- Per ReAct iteration: `0.000115 RITUAL`.
- Per tool call: `0.00023 RITUAL`.
- Real-world sovereign agent runs measured at **0.5–1 RITUAL** per run. Treat **1 RITUAL** as the safe upper bound when sizing a faucet.

## TEE Service Registry (`0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F`)

- Query `getServicesByCapability(capability, true)` to find executors. Capability codes: 0 = HTTP, 1 = LLM (verify against the registry — additions happen).
- `node.endpoint` is infrastructure metadata only. **It is not part of the precompile request payload.** Only `node.teeAddress` goes into the request.
- `node.publicKey` is required when encrypting secrets (`encryptedSecrets`) or when requesting response encryption (`userPublicKey`).

## Secrets

- Encrypt with ECIES using the executor's `publicKey` (not the chain's, not the user's wallet key).
- Sign the **raw encrypted bytes**, not their hash. Executor verifies EIP-191 over raw bytes.
- `ECIES_CONFIG.symmetricNonceLength = 12` — without this set, decryption fails with no useful error.

## Block time

- Conservative baseline: ~350 ms/block. 5,000 blocks ≈ 29 min, 10,000 ≈ 58 min.
- For dev work, use `100,000` block locks (~9.7 hours) so you don't lose to lock expiry mid-iteration. Locks only extend.
- For real timing decisions, query a recent block range — never assume cadence is fixed.

## Things that look fine but aren't

- **IP-blocked APIs:** TEE executors run from cloud IPs — many APIs (Reddit, some AWS endpoints) return 403. Use authenticated APIs or providers that don't filter by IP.
- **`Accept-Encoding: gzip`** is always sent by the executor. You receive decompressed bytes. You cannot suppress this.
- **Output cap is version-sensitive.** Some chain versions use a higher runtime cap than fee-estimation cap. Plan deposits conservatively for large responses.
- **Faucet keys are still keys.** A "test" faucet key controls a real wallet on testnet. Treat with same care.

## When unsure

- `read_ritual_skill('ritual-dapp-overview')` for the lifecycle.
- `read_ritual_skill('ritual-dapp-wallet')` for fee/deposit math.
- `read_ritual_skill('ritual-dapp-precompiles')` for the full precompile address table.
- `read_ritual_rules()` to re-read this file.
