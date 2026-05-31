# Ritkey

> MPC wallet infrastructure for AI agents on Ritual Chain

Ritkey is a modular wallet system that enables AI agents to self-onboard, manage funds, and interact with Ritual Chain without exposing private keys. Built on XOR 2-of-2 key splitting, it provides a secure foundation for autonomous agent operations.

## Architecture

```
ritkey/
├── packages/
│   ├── core/          # @ritkey/core - Wallet primitives (keys, signing, encryption)
│   ├── service/       # @ritkey/service - HTTP API, database, faucet
│   └── mcp/           # @ritkey/mcp - MCP server for AI agents
```

## Packages

### [@ritkey/core](./packages/core)
Core wallet library - key generation, XOR splitting, signing, encryption, policy enforcement.

**Use when:** Building custom wallet services or integrating Ritual Chain signing into your app.

```bash
npm install @ritkey/core
```

### [@ritkey/service](./packages/service)
Complete wallet service - REST API, SQLite database, faucet, dashboard, Sybil defense.

**Use when:** Running a wallet service for agents or users.

```bash
npm install @ritkey/service
```

### [@ritkey/mcp](./packages/mcp)
MCP server with 16 tools, 11 Ritual Chain skill docs, and bootstrap prompt.

**Use when:** Connecting AI agents (Claude, Cursor, etc.) to Ritual Chain.

```bash
npm install @ritkey/mcp
```

## Quick Start

```bash
# Clone and install
git clone https://github.com/mmorgsmorgan/ritual-agent-wallet.git
cd ritual-agent-wallet
npm install

# Generate encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Configure (add key to packages/service/.env)
cp packages/service/.env.example packages/service/.env

# Build all packages
npm run build

# Run service
npm run dev:service

# Run MCP server (in another terminal)
npm run dev:mcp
```

## Features

- **XOR 2-of-2 MPC** - Split keys between server and agent, both required to sign
- **AES-256-GCM Encryption** - Server shards encrypted at rest
- **Sybil Defense** - 1 wallet per API key, atomic claim slots
- **Policy Enforcement** - Per-tx limits, daily caps, rate limiting, whitelists
- **One-time Faucet** - Bootstrap funding for new wallets
- **Ritual Chain Native** - HTTP precompile (0x0801), LLM precompile (0x0802), RitualWallet escrow
- **MCP Integration** - 16 tools + 11 skill docs for AI agents

## Security Model

- **2-of-2 XOR splitting** - `server_shard XOR agent_shard = privateKey`
- **Fail-fast config** - Server refuses to boot with missing/zero encryption key
- **Atomic operations** - Faucet claims and API-key grants use SQLite atomicity
- **Spending policy** - Configurable limits prevent runaway spending

### Known Limitations

- **XOR 2-of-2 is not k-of-n** - Lose either shard and funds are unrecoverable
- **JS strings can't be zeroed** - Reconstructed keys live in memory until GC
- **Single-key faucet** - Compromised faucet key drains the faucet wallet

For production, consider audited TSS (Binance tss-lib, GG20/CGGMP21) or managed services (Turnkey, Lit Protocol).

## Development

```bash
# Build all packages
npm run build

# Run tests
npm test

# Run service in dev mode
npm run dev:service

# Run MCP server in dev mode
npm run dev:mcp
```

## Configuration

Set in `packages/service/.env`:

| Variable | Required | Description |
|---|---|---|
| `API_KEY` | one of API_KEY / OPEN_MODE | Bearer token for authentication |
| `OPEN_MODE=true` | one of API_KEY / OPEN_MODE | Disable auth (not recommended) |
| `ENCRYPTION_KEY` | ✓ | 32-byte hex for encrypting shards |
| `FAUCET_PRIVATE_KEY` | optional | Funded EOA for bootstrap drips |
| `FAUCET_AMOUNT` | optional | Amount per drip (default 0.01 RITUAL) |
| `RITUAL_RPC_URL` | optional | Default: https://rpc.ritualfoundation.org |
| `DATABASE_PATH` | optional | Default: ./data/wallets.db |

## API Endpoints

See [packages/service/README.md](./packages/service/README.md) for full API documentation.

Key endpoints:
- `POST /wallets` - Create wallet (1 per API key)
- `GET /wallets/:id/balance` - Check balance
- `POST /wallets/:id/send` - Sign and send transaction
- `POST /wallets/:id/fund` - Claim faucet drip
- `GET /wallets/:id/transactions` - Transaction history

## MCP Tools

See [packages/mcp/README.md](./packages/mcp/README.md) for full tool documentation.

Key tools:
- `create_wallet` - Create new MPC wallet
- `send_transaction` - Sign and broadcast
- `call_http_precompile` - Invoke HTTP precompile
- `call_llm_precompile` - Invoke LLM precompile
- `fund_wallet` - Claim faucet drip

## Roadmap

- [ ] Layer F: Global faucet daily cap circuit breaker
- [ ] Layer C: Proof-of-funds requirement (signed message from funded EOA)
- [ ] Layer A: Admin-issued invite codes for wallet creation
- [ ] Sweep-and-archive endpoint for safe wallet cleanup
- [ ] k-of-n TSS (replace XOR 2-of-2)
- [ ] Hardware security module (HSM) integration
- [ ] Multi-chain support (beyond Ritual)

## License

MIT

## Contributing

PRs welcome! Please ensure tests pass (`npm test`) and follow the existing code style.

## Support

- Issues: https://github.com/mmorgsmorgan/ritual-agent-wallet/issues
- Ritual Chain Docs: https://docs.ritual.net
