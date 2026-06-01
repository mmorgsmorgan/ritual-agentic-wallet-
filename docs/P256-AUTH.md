# Ritkey P-256 API Key Authentication

Ritkey now uses **Turnkey-style P-256 API key authentication** instead of bearer tokens. This provides:

- **Cryptographic authentication** - Requests signed with P-256 private keys
- **User/Agent separation** - Distinct identities for humans and AI agents
- **Permission-based access** - Fine-grained control over operations
- **Replay attack prevention** - Timestamp-based request validation

## Quick Start

### 1. Setup Admin User

```bash
cd packages/service
npm run setup-admin
```

This creates the first admin user with full permissions and generates P-256 API credentials.

**Save the credentials securely** - the private key is never shown again.

### 2. Create an Agent

```typescript
import { createAgentClient } from '@ritkey/core';

// Admin creates an agent
const adminClient = createAgentClient(
  'http://localhost:3000',
  process.env.ADMIN_PUBLIC_KEY!,
  process.env.ADMIN_PRIVATE_KEY!
);

const { user, apiKeys } = await adminClient.createUser({
  userName: 'trading-agent-001',
  userType: 'agent',
  apiKeys: [{ keyName: 'primary-key' }],
  permissions: [
    'wallet:create',
    'wallet:read',
    'wallet:send',
    'wallet:fund',
  ],
});

// Save agent credentials
console.log('Public Key:', apiKeys[0].publicKey);
console.log('Private Key:', apiKeys[0].privateKey);
```

### 3. Agent Creates Wallet

```typescript
// Agent authenticates with its credentials
const agentClient = createAgentClient(
  'http://localhost:3000',
  process.env.AGENT_PUBLIC_KEY!,
  process.env.AGENT_PRIVATE_KEY!
);

// Create wallet
const wallet = await agentClient.createWallet({
  label: 'Trading Wallet',
});

console.log('Wallet:', wallet.address);
console.log('Agent Shard:', wallet.agentShard);

// Fund wallet
await agentClient.fundWallet(wallet.walletId);

// Send transaction
await agentClient.sendTransaction(wallet.walletId, {
  agentShard: wallet.agentShard,
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
  value: '0.001',
});
```

## Authentication Flow

### Request Signing

Every request must include:

```
X-API-Public-Key: <compressed-P-256-public-key>
X-Signature: <request-signature>
X-Timestamp: <unix-timestamp-ms>
```

**Signature payload:**
```
METHOD|PATH|TIMESTAMP|BODY_HASH
```

Example:
```
POST|/wallets|1735574400000|a3f5e8d9...
```

The signature is created using the P-256 private key and verified by the server using the public key.

### Replay Attack Prevention

Requests with timestamps older than 5 minutes are rejected.

## Permissions

### Wallet Permissions
- `wallet:create` - Create new wallets
- `wallet:read` - View wallet details and balances
- `wallet:send` - Send transactions
- `wallet:sign` - Sign messages
- `wallet:fund` - Claim faucet funding
- `wallet:freeze` - Freeze wallets (emergency)
- `wallet:archive` - Archive wallets

### Admin Permissions
- `admin:users` - Manage users and agents
- `admin:policies` - Manage permission policies

## User Types

### Human
- Can have admin permissions
- Typically manages agents and policies
- Full access to all operations

### Agent
- Cannot have admin permissions
- Limited to assigned permissions
- Designed for autonomous operation

## API Endpoints

### User Management

**POST /users** (admin only)
```json
{
  "userName": "trading-agent-001",
  "userType": "agent",
  "apiKeys": [{ "keyName": "primary-key" }],
  "permissions": ["wallet:create", "wallet:send"]
}
```

**GET /users** (admin only)
List all users

**GET /users/me**
Get current authenticated user info

**POST /users/api-keys/revoke** (admin only)
```json
{
  "apiKeyId": "uuid"
}
```

### Wallet Operations

All wallet endpoints now require appropriate permissions:

- `POST /wallets` - Requires `wallet:create`
- `GET /wallets/:id` - Requires `wallet:read`
- `POST /wallets/:id/send` - Requires `wallet:send`
- `POST /wallets/:id/fund` - Requires `wallet:fund`

## Client SDK

The `@ritkey/core` package includes a client SDK:

```typescript
import { createAgentClient } from '@ritkey/core';

const client = createAgentClient(
  'http://localhost:3000',
  publicKey,
  privateKey
);

// All requests automatically signed
await client.createWallet({ label: 'My Wallet' });
await client.getBalance(walletId);
await client.sendTransaction(walletId, { ... });
```

## Migration from Bearer Tokens

The old `API_KEY` / `OPEN_MODE` system is **deprecated**. To migrate:

1. Run `npm run setup-admin` to create admin user
2. Use admin credentials to create agent users
3. Update agent code to use `createAgentClient()`
4. Remove `API_KEY` from `.env`

## Security Considerations

- **Private keys never stored** - Only public keys are in the database
- **Signature verification** - Every request cryptographically verified
- **Permission enforcement** - Operations checked against user permissions
- **Audit trail** - All API key usage logged with timestamps

## Example: Complete Agent Setup

See `packages/core/examples/agent-workflow.ts` for a complete example.

```bash
# Setup admin
npm run setup-admin

# Create agent (save credentials)
SETUP_AGENT=true tsx examples/agent-workflow.ts

# Run agent workflow
tsx examples/agent-workflow.ts
```
