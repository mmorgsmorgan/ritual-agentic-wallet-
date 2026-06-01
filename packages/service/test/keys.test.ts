import { describe, it, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import {
  generateWalletKeypair,
  splitKey,
  reconstructKey,
  deriveAddress,
  encryptShard,
  decryptShard,
} from '@ritkey/core';

const TEST_KEY = '0x' + 'a'.repeat(64);

describe('keys.generateWalletKeypair', () => {
  it('returns a valid secp256k1 keypair with checksummed address', () => {
    const kp = generateWalletKeypair();
    expect(kp.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(kp.publicKey).toMatch(/^0x04[0-9a-f]{128}$/);
    expect(kp.address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // Sanity: deriving address from generated key matches
    expect(deriveAddress(kp.privateKey)).toBe(kp.address);

    // Private key is a valid scalar
    const priv = Buffer.from(kp.privateKey.slice(2), 'hex');
    expect(secp256k1.utils.isValidPrivateKey(priv)).toBe(true);
  });

  it('produces unique keypairs on successive calls', () => {
    const a = generateWalletKeypair();
    const b = generateWalletKeypair();
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.address).not.toBe(b.address);
  });
});

describe('keys.split + reconstruct (XOR 2-of-2)', () => {
  it('round-trips via XOR', () => {
    const split = splitKey(TEST_KEY);
    expect(split.serverShard).toHaveLength(64);
    expect(split.agentShard).toHaveLength(64);

    const recovered = reconstructKey(split.serverShard, split.agentShard);
    expect(recovered).toBe(TEST_KEY);
  });

  it('produces shards that look random (neither equals the key)', () => {
    const split = splitKey(TEST_KEY);
    expect(split.serverShard).not.toBe(TEST_KEY.slice(2));
    expect(split.agentShard).not.toBe(TEST_KEY.slice(2));
  });

  it('rejects mismatched shard lengths', () => {
    expect(() => reconstructKey('aa'.repeat(32), 'bb'.repeat(16))).toThrow(
      /Shard length mismatch/
    );
  });

  it('derives the same address as the original key', () => {
    const kp = generateWalletKeypair();
    const split = splitKey(kp.privateKey);
    expect(split.address).toBe(kp.address);

    const recovered = reconstructKey(split.serverShard, split.agentShard);
    expect(deriveAddress(recovered)).toBe(kp.address);
  });
});

describe('keys.encryptShard / decryptShard', () => {
  const ENC_KEY = '0x' + 'b'.repeat(64);

  it('round-trips via AES-256-GCM', () => {
    const plaintext = 'shard-' + 'a'.repeat(64);
    const ct = encryptShard(plaintext, ENC_KEY);
    expect(ct.split(':')).toHaveLength(3);
    expect(decryptShard(ct, ENC_KEY)).toBe(plaintext);
  });

  it('fails on tampered ciphertext (auth tag mismatch)', () => {
    const ct = encryptShard('hello', ENC_KEY);
    const [iv, tag, body] = ct.split(':');
    // Flip the last byte of body
    const tamperedBody = body!.slice(0, -2) + (body!.slice(-2) === '00' ? 'ff' : '00');
    expect(() => decryptShard(`${iv}:${tag}:${tamperedBody}`, ENC_KEY)).toThrow();
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => encryptShard('x', '0xdeadbeef')).toThrow(
      /Encryption key must be 32 bytes/
    );
  });
});
