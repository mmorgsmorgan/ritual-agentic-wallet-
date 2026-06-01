# Ritkey Autonomous Wallet Creation

> Turnkey-style wallet provisioning for AI agents via MCP

## Overview

Agents can autonomously create their own Ritkey MPC wallets by calling a single MCP tool - no parameters needed. The system automatically:
- Creates a new wallet
- Funds it from the faucet
- Returns the wallet address and agent shard
- Binds it to the agent's identity

## How It Works

### 1. Agent Calls MCP Tool

```typescript
// Agent calls the tool (no parameters needed)
await mcp.callTool('ritkey_create_wallet');
```

### 2. Backend Checks Configuration

```typescript
// Checks if Ritkey is configured
- ENCRYPTION_KEY (required)
- FAUCET_PRIVATE_KEY (optional, for auto-funding)
- API_KEY or agent authentication
```

### 3. Wallet Creation Flow

```typescript
// Internal flow (automatic)
1. Check if agent already has a wallet (via API key hash)
2. If exists: return existing wallet info
3. If new:
   a. Generate secp256k1 keypair
   b. Split into XOR 2-of-2 shards
   c. Encrypt server shard with AES-256-GCM
   d. Store in database
   e. Bind to agent's API key
   f. Fund from faucet (if configured)
   g. Return wallet info + agent shard
```

### 4. Response to Agent

```json
{
  "success": true,
  "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
  "walletId": "uuid-here",
  "ritkeyEnabled": true,
  "funded": true,
  "isNew": true,
  "message": "Ritkey wallet provisioned: 0x742d...",
  "agentShard": "0x1a2b3c...",
  "warning": "⚠️ Save the agentShard securely - you need it to sign transactions!"
}
```

## Database Storage

```sql
-- Stored in database
wallets.id              -- Wallet UUID
wallets.address         -- Ethereum address
wallets.server_shard    -- Encrypted server shard
wallets.funded_at       -- Faucet claim timestamp

api_key_grants.api_key_hash  -- Agent identifier
api_key_grants.wallet_id     -- Bound wallet
```

## Agent Usage Example

### Step 1: Create Wallet (First Time)

```typescript
// Agent calls MCP tool
const result = await mcp.callTool('ritkey_create_wallet');

// Response
{
  "success": true,
  "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
  "agentShard": "0x1a2b3c4d5e6f...",
  "funded": true,
  "isNew": true
}

// Agent MUST save agentShard securely
await secureStorage.save('agentShard', result.agentShard);
```

### Step 2: Use Wallet

```typescript
// Send transaction
await client.sendTransaction(walletId, {
  agentShard: await secureStorage.get('agentShard'),
  to: '0x...',
  value: '0.001'
});
```

### Step 3: Subsequent Calls

```typescript
// Agent calls again (returns existing wallet)
const result = await mcp.callTool('ritkey_create_wallet');

// Response (no agentShard - already provided)
{
  "success": true,
  "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
  "funded": true,
  "isNew": false,
  "message": "Retrieved existing wallet: 0x742d..."
}
```

## Key Features

### ✅ Autonomous
- No human intervention required
- Agent calls one tool, gets wallet
- Automatic funding from faucet

### ✅ Secure
- XOR 2-of-2 MPC splitting
- Server shard encrypted at rest
- Agent shard never stored
- Bound to agent's API key

### ✅ Simple
- No parameters needed
- Idempotent (safe to call multiple times)
- Returns existing wallet if already created

### ✅ Sybil-Resistant
- 1 wallet per API key (agent identity)
- 1 faucet drip per wallet (lifetime)
- Atomic database operations

## Comparison to Turnkey

| Feature | Turnkey | Ritkey |
|---------|---------|--------|
| **Wallet Type** | TSS MPC | XOR 2-of-2 MPC |
| **Agent Tool** | `bard_create_wallet` | `ritkey_create_wallet` |
| **Parameters** | None | None |
| **Auto-funding** | No | Yes (faucet) |
| **Storage** | Turnkey cloud | Self-hosted SQLite |
| **Shard Management** | Turnkey manages | Agent holds shard |
| **Cost** | Paid service | Free (self-hosted) |

## Configuration

### Environment Variables

```bash
# Required
ENCRYPTION_KEY=<32-byte-hex>

# Optional (for auto-funding)
FAUCET_PRIVATE_KEY=0x...
FAUCET_AMOUNT=0.01

# Authentication
API_KEY=<secret>
# OR
OPEN_MODE=true
```

### MCP Server Config

```json
{
  "mcpServers": {
    "ritkey": {
      "command": "npx",
      "args": ["tsx", "/path/to/ritkey/packages/mcp/src/index.ts"],
      "env": {
        "ENCRYPTION_KEY": "your-key",
        "FAUCET_PRIVATE_KEY": "0x...",
        "API_KEY": "your-secret"
      }
    }
  }
}
```

## Security Considerations

### ✅ Safe
- Agent shard returned only once (on creation)
- Server shard encrypted at rest
- API key binding prevents wallet theft
- Faucet has per-wallet limit

### ⚠️ Agent Responsibility
- **Must save agent shard securely**
- Losing shard = losing wallet access
- No recovery mechanism (by design)

### 🔒 Production Recommendations
1. Use dedicated faucet wallet (not personal key)
2. Set `FAUCET_DAILY_CAP` to limit drainage
3. Rotate `ENCRYPTION_KEY` periodically
4. Monitor faucet balance
5. Use hardware security module (HSM) for production

## Error Handling

```typescript
// Agent should handle errors
try {
  const wallet = await mcp.callTool('ritkey_create_wallet');
  
  if (!wallet.success) {
    console.error('Failed to create wallet:', wallet.error);
    // Retry or alert human operator
  }
  
  if (wallet.isNew && wallet.agentShard) {
    // CRITICAL: Save agent shard
    await secureStorage.save('agentShard', wallet.agentShard);
  }
} catch (err) {
  console.error('MCP tool error:', err);
}
```

## Benefits

### For Agents
- ✅ Self-onboarding (no human needed)
- ✅ Instant wallet creation
- ✅ Automatic funding
- ✅ Simple API (one tool call)

### For Developers
- ✅ No external dependencies
- ✅ Self-hosted (full control)
- ✅ Open source
- ✅ Easy integration

### For Users
- ✅ No per-wallet costs
- ✅ Privacy (self-hosted)
- ✅ Transparent (open source)
- ✅ Auditable (SQLite database)

## Next Steps

1. **Setup Ritkey**
   ```bash
   npm run setup-admin
   npm run dev:service
   npm run dev:mcp
   ```

2. **Configure Agent**
   - Add Ritkey MCP server to agent config
   - Implement secure storage for agent shard

3. **Test Wallet Creation**
   ```typescript
   const wallet = await mcp.callTool('ritkey_create_wallet');
   console.log('Wallet:', wallet.walletAddress);
   ```

4. **Start Transacting**
   - Use wallet for on-chain operations
   - Monitor balance
   - Track transactions

## Support

- **Issues:** https://github.com/mmorgsmorgan/ritual-agent-wallet/issues
- **Docs:** See `/docs` directory
- **Examples:** See `packages/mcp/examples/`
