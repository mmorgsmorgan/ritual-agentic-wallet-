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
 * Sign and broadcast a transaction given an already-reconstructed private key.
 *
 * Used by the threshold-signing path, where the key was reconstructed in Rust
 * (zeroized after) and exposed once at the JS boundary. Callers are responsible
 * for not retaining the key.
 */
export async function signAndSendTransactionWithKey(
  privateKey: string,
  params: TransactionParams
): Promise<SignedTransaction> {
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
 * Sign and broadcast a transaction using reconstructed key from XOR shards (legacy).
 * The full private key exists in memory only during signing.
 */
export async function signAndSendTransaction(
  serverShard: string,
  agentShard: string,
  params: TransactionParams
): Promise<SignedTransaction> {
  const privateKey = reconstructKey(serverShard, agentShard);
  return signAndSendTransactionWithKey(privateKey, params);
}

/**
 * Sign a message (EIP-191) given an already-reconstructed private key.
 *
 * Companion to signAndSendTransactionWithKey for the threshold path.
 */
export async function signMessageWithKey(
  privateKey: string,
  message: string
): Promise<{ signature: Hex; address: Address }> {
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
