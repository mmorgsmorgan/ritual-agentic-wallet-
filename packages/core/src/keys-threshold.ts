import {
  generateThresholdKeysSimple,
  thresholdSignSimple,
  splitExistingKey,
  reconstructPrivateKey,
} from '@ritkey/crypto';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak256, getAddress, type Address, type Hex } from 'viem';

// ============================================================
// Types
// ============================================================

/** Result from threshold key splitting (2-of-3) */
export interface ThresholdKeyResult {
  shares: string[];     // 3 hex-encoded shares
  address: string;      // derived Ethereum address
  publicKey: string;    // hex public key
  threshold: number;    // minimum shares needed (2)
  totalShares: number;  // total shares (3)
}

// ============================================================
// Threshold Key Generation (Shamir 2-of-3)
// ============================================================

/**
 * Generate a new wallet with threshold key splitting (2-of-3).
 *
 * Uses Shamir's Secret Sharing - any 2 of 3 shares can reconstruct and sign.
 *
 * @returns ThresholdKeyResult with 3 shares and derived address
 */
export function generateThresholdWallet(): ThresholdKeyResult {
  // Generate 2-of-3 threshold keys using Rust crypto module
  const shareBuffers = generateThresholdKeysSimple(2, 3);

  // Parse first share to get public key (Rust returns compressed pubkey)
  const firstShare = JSON.parse(shareBuffers[0].toString());
  const compressedPubKey = firstShare.public_key;

  // Convert compressed pubkey to uncompressed for address derivation
  const compressedBytes = Buffer.from(compressedPubKey.slice(2), 'hex');
  const point = secp256k1.ProjectivePoint.fromHex(compressedBytes);
  const uncompressedBytes = point.toRawBytes(false); // false = uncompressed (65 bytes)
  const publicKey = `0x${Buffer.from(uncompressedBytes).toString('hex')}`;

  // Derive Ethereum address from uncompressed public key
  const pubKeyNoPrefix = uncompressedBytes.slice(1); // Remove 0x04 prefix
  const hash = keccak256(`0x${Buffer.from(pubKeyNoPrefix).toString('hex')}` as `0x${string}`);
  const address = getAddress(`0x${hash.slice(26)}`);

  // Convert shares to hex strings
  const shares = shareBuffers.map(buf => `0x${buf.toString('hex')}`);

  return {
    shares,
    address,
    publicKey,
    threshold: 2,
    totalShares: 3,
  };
}

/**
 * Sign a transaction using threshold shares (any 2 of 3).
 *
 * @param shares - At least 2 of the 3 key shares
 * @param messageHash - 32-byte message hash to sign
 * @returns Signature (64 bytes: r + s)
 */
export function thresholdSign(shares: string[], messageHash: Hex): Hex {
  if (shares.length < 2) {
    throw new Error('Need at least 2 shares to sign');
  }

  // Convert hex shares to buffers
  const shareBuffers = shares.map(share =>
    Buffer.from(share.startsWith('0x') ? share.slice(2) : share, 'hex')
  );

  // Convert message hash to buffer
  const messageBuffer = Buffer.from(
    messageHash.startsWith('0x') ? messageHash.slice(2) : messageHash,
    'hex'
  );

  // Sign using Rust crypto module
  const signatureBuffer = thresholdSignSimple(shareBuffers, messageBuffer);

  return `0x${signatureBuffer.toString('hex')}` as Hex;
}

// ============================================================
// Import: Split Existing Private Key into Threshold Shares
// ============================================================

/**
 * Import an existing private key into Ritkey by splitting it into 2-of-3 shares.
 *
 * Used when:
 * - User has private key from MetaMask/Rabby and wants to use Ritkey
 * - User is recovering after data loss
 * - User is moving wallet from another agent
 *
 * @param privateKey - Existing private key (0x-prefixed hex)
 * @returns ThresholdKeyResult with 3 shares and the same address as the original key
 */
export function importPrivateKey(privateKey: string): ThresholdKeyResult {
  // Validate and normalize private key
  const keyHex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error('Invalid private key: must be 32 bytes hex (64 chars)');
  }

  const privKeyBytes = Buffer.from(keyHex, 'hex');

  // Derive public key and address (same as the original key)
  const pubKeyBytes = secp256k1.getPublicKey(privKeyBytes, false); // uncompressed
  const publicKey = `0x${Buffer.from(pubKeyBytes).toString('hex')}`;
  const pubKeyNoPrefix = pubKeyBytes.slice(1);
  const hash = keccak256(`0x${Buffer.from(pubKeyNoPrefix).toString('hex')}` as `0x${string}`);
  const address = getAddress(`0x${hash.slice(26)}`);

  // Split into 2-of-3 Shamir shares using Rust crypto module
  const shareBuffers = splitExistingKey(privKeyBytes, 2, 3);

  // Convert shares to hex strings
  const shares = shareBuffers.map(buf => `0x${buf.toString('hex')}`);

  return {
    shares,
    address,
    publicKey,
    threshold: 2,
    totalShares: 3,
  };
}

// ============================================================
// Export: Reconstruct Private Key from Shares
// ============================================================

/**
 * Reconstruct a private key from threshold shares for export.
 *
 * ⚠️ WARNING: This exposes the private key in plaintext.
 * Only use for legitimate export scenarios (MetaMask, Rabby, etc.)
 * After export, consider the wallet "compromised" - the user has full control.
 *
 * @param shares - At least 2 of the 3 key shares
 * @returns Private key as 0x-prefixed hex string
 */
export function exportPrivateKey(shares: string[]): string {
  if (shares.length < 2) {
    throw new Error('Need at least 2 shares to export private key');
  }

  // Convert hex shares to buffers
  const shareBuffers = shares.map(share =>
    Buffer.from(share.startsWith('0x') ? share.slice(2) : share, 'hex')
  );

  // Reconstruct private key using Rust crypto module
  const privateKeyBuffer = reconstructPrivateKey(shareBuffers);

  return `0x${privateKeyBuffer.toString('hex')}`;
}

// ============================================================
// Legacy XOR Functions (Deprecated - for migration only)
// ============================================================

/**
 * @deprecated Use generateThresholdWallet() instead
 *
 * Legacy XOR 2-of-2 splitting. Only kept for migration purposes.
 */
export function splitKeyXOR(privateKeyHex: string): {
  serverShard: string;
  agentShard: string;
  address: string;
  publicKey: string;
} {
  throw new Error(
    'XOR splitting is deprecated. Use generateThresholdWallet() for 2-of-3 threshold keys.'
  );
}

/**
 * @deprecated Use thresholdSign() instead
 *
 * Legacy XOR reconstruction. Only kept for migration purposes.
 */
export function reconstructKeyXOR(serverShard: string, agentShard: string): string {
  throw new Error(
    'XOR reconstruction is deprecated. Use thresholdSign() with threshold shares.'
  );
}
