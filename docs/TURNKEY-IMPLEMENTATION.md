# Ritkey: Turnkey-Style Authentication Implementation ✓

## What We Built

Implemented **P-256 API key authentication** for Ritkey, enabling both humans and AI agents to securely interact with the wallet service using cryptographic signatures instead of bearer tokens.

## Architecture

### 3-Layer System

```
┌─────────────────────────────────────────────────────────┐
│  @ritkey/core                                           │
│  • P-256 keypair generation                             │
│  • Request signing & verification                       │
│  • Client SDK (RitkeyClient)                            │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  @ritkey/service                                        │
│  • User/Agent management (DB tables)                    │
│  • Permission system (9 permissions)                    │
│  • Auth middleware (signature verification)             │
│  • User management API (/users endpoints)               │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Agents & Humans                                        │
│  • Authenticate with P-256 keypairs                     │
│  • Create wallets autonomously                          │
│  • Permission-based access control                      │
└─────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Core Authentication (`@ritkey/core`)

**`src/auth.ts`**
- `generateApiKeyPair()` - Generate P-256 keypairs
- `signRequest()` - Sign requests with private key
- `verifyRequestSignature()` - Verify signatures with public key
- `createRequestPayload()` - Format: `METHOD|PATH|TIMESTAMP|BODY_HASH`

**`src/client.ts`**
- `RitkeyClient` class - Full SDK for agents/humans
- `createAgentClient()` - Factory function
- Auto-signs all requests with P-256 keys

### 2. Service Layer (`@ritkey/service`)

**`src/db/users.ts`**
- User management (human/agent types)
- API key storage (public keys only)
- Permission system (9 granular permissions)
- Tables: `users`, `api_keys`, `user_permissions`

**`src/api/auth-middleware.ts`**
- `apiKeyAuthMiddleware` - Verify P-256 signatures
- `requirePermission()` - Permission checks
- `requireAdmin()` - Admin-only operations
- Replay attack prevention (5-minute window)

**`src/api/users.ts`**
- `POST /users` - Create users/agents (admin only)
- `GET /users` - List all users (admin only)
- `GET /users/me` - Current user info
- `POST /users/api-keys/revoke` - Revoke keys (admin only)

### 3. Setup & Examples

**`scripts/setup-admin.ts`**
- Interactive CLI to create first admin user
- Generates P-256 credentials
- Grants all permissions

**`examples/agent-workflow.ts`**
- Complete example: admin creates agent → agent creates wallet → agent transacts
- Shows full Turnkey-style workflow

## Permissions System

### Wallet Permissions
- `wallet:create` - Create new wallets
- `wallet:read` - View wallet details
- `wallet:send` - Send transactions
- `wallet:sign` - Sign messages
- `wallet:fund` - Claim faucet
- `wallet:freeze` - Emergency freeze
- `wallet:archive` - Archive wallets

### Admin Permissions
- `admin:users` - Manage users/agents
- `admin:policies` - Manage policies

## User Types

### Human
- Can have admin permissions
- Manages agents and policies
- Full system access

### Agent
- Cannot be admin
- Limited to assigned permissions
- Autonomous operation

## Authentication Flow

```
1. Agent has P-256 keypair (public + private)
2. Agent creates request payload: METHOD|PATH|TIMESTAMP|BODY_HASH
3. Agent signs payload with private key
4. Agent sends request with headers:
   - X-API-Public-Key: <public-key>
   - X-Signature: <signature>
   - X-Timestamp: <timestamp>
5. Server verifies signature with public key
6. Server checks user permissions
7. Server processes request
```

## Security Features

✓ **Cryptographic authentication** - P-256 ECDSA signatures
✓ **No stored secrets** - Only public keys in database
✓ **Replay attack prevention** - 5-minute timestamp window
✓ **Permission-based access** - Fine-grained control
✓ **Audit trail** - Last used timestamps on API keys
✓ **Key revocation** - Admin can revoke compromised keys

## Usage Example

```typescript
// 1. Admin creates agent
const adminClient = createAgentClient(url, adminPub, adminPriv);
const { apiKeys } = await adminClient.createUser({
  userName: 'trading-agent',
  userType: 'agent',
  apiKeys: [{ keyName: 'primary' }],
  permissions: ['wallet:create', 'wallet:send'],
});

// 2. Agent authenticates
const agentClient = createAgentClient(url, apiKeys[0].publicKey, apiKeys[0].privateKey);

// 3. Agent creates wallet
const wallet = await agentClient.createWallet();

// 4. Agent transacts
await agentClient.fundWallet(wallet.walletId);
await agentClient.sendTransaction(wallet.walletId, {
  agentShard: wallet.agentShard,
  to: '0x...',
  value: '0.001',
});
```

## Files Created

### Core Package
- `src/auth.ts` - P-256 authentication primitives
- `src/client.ts` - RitkeyClient SDK
- `examples/agent-workflow.ts` - Complete example

### Service Package
- `src/db/users.ts` - User/agent management
- `src/api/auth-middleware.ts` - Auth middleware
- `src/api/users.ts` - User management endpoints
- `scripts/setup-admin.ts` - Admin setup CLI

### Documentation
- `docs/P256-AUTH.md` - Complete authentication guide

## Migration Path

Old system (bearer tokens):
```bash
API_KEY=secret-token
```

New system (P-256 keys):
```bash
npm run setup-admin  # Creates admin with P-256 keys
# Admin creates agents with their own P-256 keys
# Agents authenticate with signatures
```

## Next Steps

1. ✓ P-256 authentication system
2. ✓ User/agent management
3. ✓ Permission system
4. ✓ Client SDK
5. ✓ Setup scripts
6. ✓ Documentation

**Ready for:**
- Layer F: Faucet daily cap
- Layer C: Proof-of-funds
- Layer A: Invite codes (can now use permission system)
- Integration with The Cauldron NFT platform

## Benefits

- **Autonomous agents** - Agents can self-manage wallets
- **Security** - Cryptographic auth > bearer tokens
- **Scalability** - Create unlimited agents with different permissions
- **Auditability** - Track all API key usage
- **Flexibility** - Fine-grained permission control
