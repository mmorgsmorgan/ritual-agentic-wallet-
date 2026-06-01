# @ritkey/service

HTTP service for Ritkey - REST API, database, faucet, and dashboard for managing MPC wallets on Ritual Chain.

## Features

- **REST API** - Create wallets, send transactions, check balances
- **SQLite Database** - Persistent storage for wallets, transactions, audit logs
- **Faucet** - One-time bootstrap funding for new wallets
- **Sybil Defense** - 1 wallet per API key, atomic claim slots
- **Dashboard** - Web UI for wallet management
- **Policy Enforcement** - Per-tx limits, daily caps, emergency freeze

## Installation

```bash
npm install @ritkey/service
```

## Quick Start

```bash
# Set up environment
cp .env.example .env
# Generate encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Add to .env, then:
npm run dev
```

## API Endpoints

- `POST /wallets` - Create a new wallet
- `GET /wallets/:id/balance` - Check balance
- `POST /wallets/:id/send` - Send transaction
- `POST /wallets/:id/fund` - Claim faucet drip
- `GET /wallets/:id/transactions` - Transaction history

See the [API documentation](../../README.md) for full details.

## Configuration

Set in `.env`:
- `API_KEY` or `OPEN_MODE=true` - Authentication
- `ENCRYPTION_KEY` - 32-byte hex for encrypting shards
- `FAUCET_PRIVATE_KEY` - Optional faucet funding key
- `DATABASE_PATH` - SQLite database location

## License

MIT
