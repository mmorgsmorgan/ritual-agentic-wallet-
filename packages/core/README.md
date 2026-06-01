# @ritkey/core

Core MPC wallet library for Ritual Chain. Provides wallet creation, key management, XOR 2-of-2 splitting, signing, and encryption primitives.

## Features

- **Wallet Creation** - Generate secp256k1 keypairs for Ritual Chain
- **XOR 2-of-2 Key Splitting** - Split private keys into two shards using XOR
- **AES-256-GCM Encryption** - Encrypt key shards at rest
- **Transaction Signing** - Sign transactions and messages (EIP-191)
- **Policy Enforcement** - Per-tx limits, daily caps, rate limiting, whitelists
- **Ritual Chain Helpers** - RPC client, balance checks, precompile interfaces

## Installation

```bash
npm install @ritkey/core
```

## Usage

```typescript
import { createWallet, signTransaction, encryptShard } from '@ritkey/core';

// Create a new wallet
const { privateKey, address, publicKey } = createWallet();

// Split into XOR shards
const { serverShard, agentShard } = splitKey(privateKey);

// Encrypt server shard
const encrypted = encryptShard(serverShard, encryptionKey);

// Sign a transaction
const signature = await signTransaction(privateKey, txData);
```

## Architecture

This is a pure library with no external services. It handles:
- Cryptographic operations (key generation, signing, encryption)
- Policy validation logic
- Ritual Chain RPC interactions

For a complete wallet service with database, HTTP API, and faucet, see `@ritkey/service`.

## License

MIT
