/**
 * @ritkey/core - Core MPC wallet library
 *
 * Provides wallet creation, key management, threshold signatures (Shamir 2-of-3),
 * signing, and encryption primitives for Ritual Chain.
 */

export * from './keys.js';
export * from './keys-threshold.js'; // NEW: Threshold signatures (Shamir 2-of-3)
export * from './signer.js';
export * from './policy.js';
export * from './ritual.js';
export * from './config.js';
export * from './auth.js';
export * from './client.js';
