import { privateKeyToAccount } from 'viem/accounts';
import {
  createWalletClient,
  http,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { reconstructKey } from './keys.js';
import { ritualChain, getPublicClient } from './ritual.js';

// ============================================================
// Types
// ============================================================

export interface SignedTransaction {
  hash: Hex;
  from: Address;
  to: Address;
  value: string;
}

export interface TransactionParams {
  to: Address;
  value?: string; // in RITUAL (ether units)
  data?: Hex;
  gas?: bigint;
}

// ============================================================
// Signing Operations
// ============================================================

/**
 * Sign and broadcast a transaction using reconstructed key from shards.
 * The full private key exists in memory only during signing.
 */
export async function signAndSendTransaction(
  serverShard: string,
  agentShard: string,
  params: TransactionParams
): Promise<SignedTransaction> {
  const privateKey = reconstructKey(serverShard, agentShard);

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: ritualChain,
    transport: http(),
  });
  const publicClient = getPublicClient();

  const hash = await walletClient.sendTransaction({
    to: params.to,
    value: params.value ? parseEther(params.value) : 0n,
    data: params.data || '0x',
    gas: params.gas,
  });

  await publicClient.waitForTransactionReceipt({ hash });

  return {
    hash,
    from: account.address,
    to: params.to,
    value: params.value || '0',
  };
}

/**
 * Sign a message (EIP-191 personal_sign) using reconstructed key.
 */
export async function signMessage(
  serverShard: string,
  agentShard: string,
  message: string
): Promise<{ signature: Hex; address: Address }> {
  const privateKey = reconstructKey(serverShard, agentShard);

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: ritualChain,
    transport: http(),
  });

  const signature = await walletClient.signMessage({ message });

  return { signature, address: account.address };
}

/**
 * Sign typed data (EIP-712) using reconstructed key.
 */
export async function signTypedData(
  serverShard: string,
  agentShard: string,
  domain: any,
  types: any,
  primaryType: string,
  message: any
): Promise<{ signature: Hex; address: Address }> {
  const privateKey = reconstructKey(serverShard, agentShard);

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: ritualChain,
    transport: http(),
  });

  const signature = await walletClient.signTypedData({
    domain,
    types,
    primaryType,
    message,
  });

  return { signature, address: account.address };
}
