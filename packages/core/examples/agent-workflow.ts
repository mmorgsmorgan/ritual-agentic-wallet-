/**
 * Example: Agent creating and using a wallet with Ritkey
 *
 * This demonstrates the Turnkey-style workflow:
 * 1. Admin creates an agent user with API keys
 * 2. Agent uses those keys to authenticate
 * 3. Agent creates a wallet and performs operations
 */

import { createAgentClient, generateApiKeyCredentials } from '@ritkey/core';

// ============================================================
// Step 1: Admin creates an agent user
// ============================================================

async function setupAgent() {
  // Admin uses their credentials to create an agent
  const adminClient = createAgentClient(
    'http://localhost:3000',
    process.env.ADMIN_PUBLIC_KEY!,
    process.env.ADMIN_PRIVATE_KEY!
  );

  // Create agent with wallet creation permissions
  const { user, apiKeys } = await adminClient.createUser({
    userName: 'trading-agent-001',
    userType: 'agent',
    apiKeys: [
      { keyName: 'primary-key' },
    ],
    permissions: [
      'wallet:create',
      'wallet:read',
      'wallet:send',
      'wallet:sign',
      'wallet:fund',
    ],
  });

  console.log('✓ Agent created:', user.userName);
  console.log('✓ API Key:', apiKeys[0].keyName);
  console.log('⚠️  Save these credentials securely:');
  console.log('   Public Key:', apiKeys[0].publicKey);
  console.log('   Private Key:', apiKeys[0].privateKey);

  return {
    publicKey: apiKeys[0].publicKey,
    privateKey: apiKeys[0].privateKey,
  };
}

// ============================================================
// Step 2: Agent authenticates and creates wallet
// ============================================================

async function agentWorkflow() {
  // Agent loads its credentials (from secure storage)
  const agentClient = createAgentClient(
    'http://localhost:3000',
    process.env.AGENT_PUBLIC_KEY!,
    process.env.AGENT_PRIVATE_KEY!
  );

  // Verify authentication
  const me = await agentClient.getMe();
  console.log('✓ Authenticated as:', me.user.userName);
  console.log('✓ Permissions:', me.permissions);

  // Create a wallet
  const wallet = await agentClient.createWallet({
    label: 'Trading Wallet',
  });

  console.log('✓ Wallet created:', wallet.address);
  console.log('✓ Agent shard:', wallet.agentShard.slice(0, 20) + '...');
  console.log('⚠️  Save agent shard securely - needed for signing!');

  // Claim faucet funding
  const funding = await agentClient.fundWallet(wallet.walletId);
  console.log('✓ Funded:', funding.amount, 'RITUAL');
  console.log('✓ Tx:', funding.explorer);

  // Check balance
  const balance = await agentClient.getBalance(wallet.walletId);
  console.log('✓ Balance:', balance.native.formatted, 'RITUAL');

  // Send a transaction
  const tx = await agentClient.sendTransaction(wallet.walletId, {
    agentShard: wallet.agentShard,
    to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
    value: '0.001',
  });

  console.log('✓ Transaction sent:', tx.hash);
  console.log('✓ Explorer:', tx.explorer);

  return wallet;
}

// ============================================================
// Step 3: Run the example
// ============================================================

async function main() {
  console.log('🔧 Ritkey Agent Example\n');

  // Admin creates agent (run once)
  if (process.env.SETUP_AGENT === 'true') {
    const credentials = await setupAgent();
    console.log('\n📝 Add these to your .env:');
    console.log(`AGENT_PUBLIC_KEY=${credentials.publicKey}`);
    console.log(`AGENT_PRIVATE_KEY=${credentials.privateKey}`);
    return;
  }

  // Agent workflow (normal operation)
  await agentWorkflow();
}

main().catch(console.error);
