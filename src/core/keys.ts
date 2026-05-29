import { secp256k1 } from '@noble/curves/secp256k1';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { keccak256, getAddress } from 'viem';

// ============================================================
// Types
// ============================================================

/** Result from wallet key generation */
export interface WalletKeyPair {
  privateKey: string;  // hex with 0x prefix
  publicKey: string;   // hex with 0x prefix (uncompressed)
  address: string;     // checksummed Ethereum address
}

/** Result from key splitting */
export interface SplitKeyResult {
  serverShard: string;  // hex-encoded server shard
  agentShard: string;   // hex-encoded agent shard
  address: string;      // derived Ethereum address
  publicKey: string;    // hex public key
}

// ============================================================
// Key Generation
// ============================================================

/**
 * Generate a new secp256k1 keypair for a wallet.
 */
export function generateWalletKeypair(): WalletKeyPair {
  const privKeyBytes = secp256k1.utils.randomPrivateKey();
  const pubKeyBytes = secp256k1.getPublicKey(privKeyBytes, false); // uncompressed

  const privateKey = `0x${Buffer.from(privKeyBytes).toString('hex')}`;
  const publicKey = `0x${Buffer.from(pubKeyBytes).toString('hex')}`;

  // Derive address: keccak256(pubkey_without_prefix) → last 20 bytes
  const pubKeyNoPrefix = pubKeyBytes.slice(1);
  const hash = keccak256(
    `0x${Buffer.from(pubKeyNoPrefix).toString('hex')}` as `0x${string}`
  );
  const address = getAddress(`0x${hash.slice(26)}`);

  return { privateKey, publicKey, address };
}

// ============================================================
// 2-of-2 XOR Key Splitting
// ============================================================

/**
 * Split a private key into two shards using XOR-based splitting.
 *
 * This is a simple 2-of-2 scheme — both shards are required to reconstruct.
 *   shard1 = random bytes (server keeps this)
 *   shard2 = key XOR shard1 (agent receives this)
 *   Reconstruction: key = shard1 XOR shard2
 */
export function splitKey(privateKeyHex: string): SplitKeyResult {
  const keyHex = privateKeyHex.startsWith('0x')
    ? privateKeyHex.slice(2)
    : privateKeyHex;
  const keyBytes = Buffer.from(keyHex, 'hex');

  // Generate random shard (server keeps this)
  const serverShardBytes = randomBytes(keyBytes.length);

  // Agent shard = key XOR server shard
  const agentShardBytes = Buffer.alloc(keyBytes.length);
  for (let i = 0; i < keyBytes.length; i++) {
    agentShardBytes[i] = keyBytes[i]! ^ serverShardBytes[i]!;
  }

  // Derive address from private key
  const pubKeyBytes = secp256k1.getPublicKey(keyBytes, false);
  const pubKeyNoPrefix = pubKeyBytes.slice(1);
  const hash = keccak256(
    `0x${Buffer.from(pubKeyNoPrefix).toString('hex')}` as `0x${string}`
  );
  const address = getAddress(`0x${hash.slice(26)}`);
  const publicKey = `0x${Buffer.from(pubKeyBytes).toString('hex')}`;

  // Zero out the original key from memory
  keyBytes.fill(0);

  return {
    serverShard: serverShardBytes.toString('hex'),
    agentShard: agentShardBytes.toString('hex'),
    address,
    publicKey,
  };
}

/**
 * Reconstruct private key from server shard and agent shard.
 * key = serverShard XOR agentShard
 *
 * IMPORTANT: The caller should use the key immediately and discard references.
 */
export function reconstructKey(
  serverShardHex: string,
  agentShardHex: string
): string {
  const serverBytes = Buffer.from(serverShardHex, 'hex');
  const agentBytes = Buffer.from(agentShardHex, 'hex');

  if (serverBytes.length !== agentBytes.length) {
    throw new Error('Shard length mismatch');
  }

  const keyBytes = Buffer.alloc(serverBytes.length);
  for (let i = 0; i < serverBytes.length; i++) {
    keyBytes[i] = serverBytes[i]! ^ agentBytes[i]!;
  }

  // Validate the reconstructed key is a valid secp256k1 private key
  try {
    secp256k1.getPublicKey(keyBytes);
  } catch {
    throw new Error('Reconstructed key is not a valid secp256k1 private key');
  }

  return `0x${keyBytes.toString('hex')}`;
}

/**
 * Derive Ethereum address from a private key hex string.
 */
export function deriveAddress(privateKeyHex: string): string {
  const keyHex = privateKeyHex.startsWith('0x')
    ? privateKeyHex.slice(2)
    : privateKeyHex;
  const keyBytes = Buffer.from(keyHex, 'hex');
  const pubKeyBytes = secp256k1.getPublicKey(keyBytes, false);
  const pubKeyNoPrefix = pubKeyBytes.slice(1);
  const hash = keccak256(
    `0x${Buffer.from(pubKeyNoPrefix).toString('hex')}` as `0x${string}`
  );
  return getAddress(`0x${hash.slice(26)}`);
}

// ============================================================
// Shard Encryption (at-rest protection)
// ============================================================

/**
 * Encrypt a shard for at-rest storage using AES-256-GCM.
 * Returns a string in format: iv:authTag:ciphertext (all hex).
 */
export function encryptShard(shard: string, encryptionKey: string): string {
  const key = Buffer.from(encryptionKey.replace('0x', ''), 'hex');
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (64 hex chars)');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(shard, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a shard from at-rest storage.
 */
export function decryptShard(
  encryptedShard: string,
  encryptionKey: string
): string {
  const parts = encryptedShard.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted shard format');
  }
  const [ivHex, authTagHex, ciphertext] = parts as [string, string, string];

  const key = Buffer.from(encryptionKey.replace('0x', ''), 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
