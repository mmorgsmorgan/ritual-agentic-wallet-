# Ritual Agent Wallet

> MPC wallet service for AI agents on **Ritual Chain** (chain ID 1979). Self-onboards via an MCP server that ships with bundled Ritual skills, hard rules, and a one-shot bootstrap prompt — agents call `create_wallet` and are immediately Ritual-aware.

## Why this exists

AI agents need wallets, but giving an agent a private key directly is a bad idea. This service provides:

- **2-of-2 MPC signing** — the server holds an AES-256-GCM-encrypted key shard, the agent holds the other shard. Both are required to sign. Neither party can act unilaterally.
- **A faucet with Sybil defense** — every new wallet can claim one fixed-amount drip, lifetime. The same API key can only ever own one wallet.
- **Policy enforcement** — per-tx limit, daily cap, destination whitelist, rate limit, emergency freeze.
- **An MCP server** that exposes wallet operations as tools any agent (Claude, GPT, Cursor, etc.) can discover and invoke, plus a bundle of Ritual-Chain documentation (10 SKILL.md files) and a curated rules doc — agents self-bootstrap with zero extra setup.
- **Ritual-native helpers** — encoded HTTP precompile (`0x0801`), LLM precompile (`0x0802`), TEE executor lookup, RitualWallet escrow deposit/withdraw.

## Quick start

```bash
git clone https://github.com/mmorgsmorgan/ritual-agent-wallet.git
cd ritual-agent-wallet
npm install
cp .env.example .env
# Generate a real ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Paste it into .env, set API_KEY=<your-secret>, then:
npm run dev          # starts the HTTP API on :3000
npm run mcp          # in another shell, starts the MCP stdio server
```

## Architecture

```
┌─────────────┐    MCP (stdio)      ┌──────────────────────────┐
│  AI agent   │ ◄─────────────────► │  MCP server              │
│ (Claude,    │   16 tools          │  • wallet ops            │
│  Cursor…)   │   11 resources      │  • Ritual skill docs     │
└─────────────┘   1 bootstrap       │  • bootstrap prompt      │
                                    └────────────┬─────────────┘
                                                 │
                                                 ▼
                                    ┌──────────────────────────┐
                                    │  Express REST API        │
                                    │  • /wallets              │
                                    │  • /wallets/:id/{balance,│
                                    │    send,sign,fund,…}     │
                                    │  • /wallets/me           │
                                    └────────────┬─────────────┘
                                                 │
                                                 ▼
                                    ┌──────────────────────────┐
                                    │  Ritual Chain (ID 1979)  │
                                    │  RitualWallet escrow,    │
                                    │  HTTP & LLM precompiles  │
                                    └──────────────────────────┘
```

## Configuration

Set in `.env` (see `.env.example`):

| Var | Required | Notes |
|---|---|---|
| `API_KEY` | one of API_KEY / OPEN_MODE | Bearer token clients must present. |
| `OPEN_MODE=true` | one of API_KEY / OPEN_MODE | Disables auth entirely. Not recommended for shared servers. |
| `ENCRYPTION_KEY` | ✓ | 32-byte hex. Encrypts wallet shards at rest. Server refuses to boot if missing or zero. |
| `FAUCET_PRIVATE_KEY` | optional | If set, enables `POST /wallets/:id/fund`. |
| `FAUCET_AMOUNT` | optional | Default `0.01` RITUAL per drip. |
| `RITUAL_RPC_URL` | optional | Default `https://rpc.ritualfoundation.org`. |
| `PORT` | optional | Default `3000`. |
| `DATABASE_PATH` | optional | Default `./data/wallets.db`. |

## REST API

All endpoints require `Authorization: Bearer <API_KEY>` unless `OPEN_MODE=true`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health probe (no auth). |
| `GET` | `/chain` | Ritual Chain config, contracts, precompiles (no auth). |
| `POST` | `/wallets` | Create a new agent wallet. Returns `{ walletId, address, agentShard, next }`. **1 wallet per API key, lifetime.** |
| `GET` | `/wallets` | List all wallets. |
| `GET` | `/wallets/me` | Return the wallet bound to the calling API key. |
| `GET` | `/wallets/:id` | Wallet detail. |
| `GET` | `/wallets/:id/balance` | Native + RitualWallet escrow balance. |
| `POST` | `/wallets/:id/send` | Sign + broadcast a tx. Body: `{ agentShard, to, value, data }`. |
| `POST` | `/wallets/:id/sign` | Sign a message (EIP-191). Body: `{ agentShard, message }`. |
| `POST` | `/wallets/:id/deposit-ritual` | Deposit to RitualWallet escrow. |
| `POST` | `/wallets/:id/fund` | One-time faucet drip (requires `FAUCET_PRIVATE_KEY`). |
| `GET` | `/wallets/:id/transactions` | Tx history. |
| `GET` | `/wallets/:id/audit` | Audit log. |
| `PATCH` | `/wallets/:id/policy` | Update spending policy. |
| `POST` | `/wallets/:id/freeze` | Emergency freeze. |
| `POST` | `/wallets/:id/unfreeze` | Unfreeze. |

## MCP server

Run `npm run mcp` to start the stdio MCP server. Configure it in Claude Desktop / Cursor like:

```jsonc
{
  "mcpServers": {
    "ritual-agent-wallet": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/ritual-agent-wallet/src/mcp/index.ts"],
      "env": {
        "ENCRYPTION_KEY": "your-32-byte-hex-key",
        "API_KEY": "your-secret",
        "DATABASE_PATH": "/absolute/path/to/data/wallets.db"
      }
    }
  }
}
```

### Tools (16)
`create_wallet`, `get_wallet_info`, `get_balance`, `send_transaction`, `deposit_to_ritual_wallet`, `sign_message`, `list_wallets`, `get_transaction_history`, `call_http_precompile`, `call_llm_precompile`, `estimate_gas`, `fund_wallet`, `list_ritual_skills`, `read_ritual_skill`, `read_ritual_rules`, `get_chain_info`.

### Resources (11)
- `ritual-skill://<id>` for each bundled skill (`ritual-dapp-overview`, `-wallet`, `-http`, `-llm`, `-precompiles`, `-x402`, `-secrets`, `-block-time`, `-scheduler`, `-agents`).
- `ritual-rules://hard-constraints` — the curated revert-on-violation rules.

### Prompts (1)
- `ritual-bootstrap` — one-shot cold-start preamble. Read this once at session start.

When an agent calls `create_wallet`, the response includes a `next.steps` array pointing at the bootstrap prompt and the first three follow-up calls — agents that don't browse prompts still get pointed at them.

## Security model

- **2-of-2 XOR splitting.** `server_shard XOR agent_shard = privateKey`. Both shards required to reconstruct. The server never sees the agent shard after creation; the agent never sees the server shard.
- **AES-256-GCM at rest.** Server shards are encrypted with `ENCRYPTION_KEY` before being written to SQLite. Losing the encryption key + the SQLite DB together is the only way an attacker recovers shards.
- **Fail-fast config.** Server refuses to boot with a missing/zero `ENCRYPTION_KEY`, or when both `API_KEY` and `OPEN_MODE=true` are set.
- **Sybil defense (layer B).** `api_key_grants(api_key_hash PK, wallet_id UNIQUE)` enforces 1 wallet per API-key sha256, atomically.
- **Spending policy.** Per-tx limit (default 1 RITUAL), daily cap (5 RITUAL), rate limit (10 tx/min), optional destination whitelist, emergency freeze.

### Known limits

- **XOR 2-of-2 is not k-of-n.** Lose either shard and the wallet is unrecoverable. For production-grade MPC, use audited TSS (Binance `tss-lib`, GG20/CGGMP21) or a managed service (Turnkey, Lit Protocol).
- **JS strings can't be zeroed.** The code attempts to zero working buffers, but reconstructed key strings live in immutable string memory until GC. Use a separate process and short-lived memory if this matters.
- **The faucet is single-key.** A compromised `FAUCET_PRIVATE_KEY` drains the faucet wallet. Use a dedicated key, not a personal one, for any non-trivial deployment.

## Development

```bash
npm run dev          # tsx watch
npm run build        # tsc + copy non-TS assets
npm test             # 66 tests across 8 files
npm run test:watch
```

## License

MIT.
