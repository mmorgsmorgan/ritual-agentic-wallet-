/**
 * Ritkey Wallet Integration for BARD
 *
 * Provides autonomous wallet creation for agents via MCP tool.
 * Similar to Turnkey integration but using Ritkey's MPC wallet system.
 */

import { createAgentClient, type RitkeyClient } from '@ritkey/core';

interface RitkeyConfig {
  apiUrl: string;
  publicKey: string;
  privateKey: string; // JWK format
  enabled: boolean;
}

interface RitkeyWalletResult {
  walletId: string;
  address: string;
  agentShard: string;
  funded: boolean;
}

/**
 * Load Ritkey configuration from environment
 */
export function loadRitkeyConfig(): RitkeyConfig {
  const apiUrl = process.env.RITKEY_API_URL || 'http://localhost:3000';
  const publicKey = process.env.RITKEY_PUBLIC_KEY || '';
  const privateKey = process.env.RITKEY_PRIVATE_KEY || '';

  const enabled = !!(publicKey && privateKey);

  return {
    apiUrl,
    publicKey,
    privateKey,
    enabled,
  };
}

/**
 * Create Ritkey client
 */
export function createRitkeyClient(config: RitkeyConfig): RitkeyClient {
  if (!config.enabled) {
    throw new Error('Ritkey is not configured. Set RITKEY_PUBLIC_KEY and RITKEY_PRIVATE_KEY.');
  }

  return createAgentClient(
    config.apiUrl,
    config.publicKey,
    config.privateKey
  );
}

/**
 * Get or create agent wallet via Ritkey
 *
 * @param db - Database connection
 * @param agentId - Agent ID
 * @param agentName - Agent name
 * @returns Wallet information
 */
export async function getOrCreateAgentWallet(
  db: any,
  agentId: string,
  agentName: string
): Promise<RitkeyWalletResult> {
  // Check if agent already has a wallet
  const existingAgent = db.prepare(
    'SELECT ritkey_wallet_id, ritkey_address, ritkey_agent_shard FROM agents WHERE id = ?'
  ).get(agentId);

  if (existingAgent?.ritkey_wallet_id) {
    return {
      walletId: existingAgent.ritkey_wallet_id,
      address: existingAgent.ritkey_address,
      agentShard: existingAgent.ritkey_agent_shard,
      funded: true, // Assume already funded if wallet exists
    };
  }

  // Load Ritkey config
  const config = loadRitkeyConfig();
  if (!config.enabled) {
    throw new Error('Ritkey is not configured');
  }

  // Create Ritkey client
  const client = createRitkeyClient(config);

  // Create wallet via Ritkey
  const wallet = await client.createWallet({
    label: `bard-agent-${agentName}`,
  });

  // Fund wallet from faucet
  let funded = false;
  try {
    await client.fundWallet(wallet.walletId);
    funded = true;
  } catch (err) {
    console.warn('Failed to fund wallet from faucet:', err);
  }

  // Store in database
  db.prepare(`
    UPDATE agents
    SET ritkey_wallet_id = ?,
        ritkey_address = ?,
        ritkey_agent_shard = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(wallet.walletId, wallet.address, wallet.agentShard, agentId);

  return {
    walletId: wallet.walletId,
    address: wallet.address,
    agentShard: wallet.agentShard,
    funded,
  };
}

/**
 * Get agent wallet balance
 */
export async function getAgentWalletBalance(
  agentId: string,
  db: any
): Promise<{ native: string; escrow: string } | null> {
  const agent = db.prepare(
    'SELECT ritkey_wallet_id FROM agents WHERE id = ?'
  ).get(agentId);

  if (!agent?.ritkey_wallet_id) {
    return null;
  }

  const config = loadRitkeyConfig();
  if (!config.enabled) {
    throw new Error('Ritkey is not configured');
  }

  const client = createRitkeyClient(config);
  const balance = await client.getBalance(agent.ritkey_wallet_id);

  return {
    native: balance.native.formatted,
    escrow: balance.ritualWallet.formatted,
  };
}

/**
 * Send transaction from agent wallet
 */
export async function sendAgentTransaction(
  agentId: string,
  db: any,
  params: {
    to: string;
    value: string;
    data?: string;
  }
): Promise<{ hash: string; explorer: string }> {
  const agent = db.prepare(
    'SELECT ritkey_wallet_id, ritkey_agent_shard FROM agents WHERE id = ?'
  ).get(agentId);

  if (!agent?.ritkey_wallet_id || !agent?.ritkey_agent_shard) {
    throw new Error('Agent does not have a Ritkey wallet');
  }

  const config = loadRitkeyConfig();
  if (!config.enabled) {
    throw new Error('Ritkey is not configured');
  }

  const client = createRitkeyClient(config);
  const result = await client.sendTransaction(agent.ritkey_wallet_id, {
    agentShard: agent.ritkey_agent_shard,
    to: params.to,
    value: params.value,
    data: params.data,
  });

  return {
    hash: result.hash,
    explorer: result.explorer,
  };
}
