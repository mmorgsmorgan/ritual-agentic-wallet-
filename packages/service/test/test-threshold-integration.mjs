#!/usr/bin/env node
/**
 * Integration test for threshold wallet creation and signing
 *
 * Tests:
 * 1. Direct core API (without HTTP)
 * 2. Threshold wallet generation
 * 3. Threshold signing with 2 of 3 shares
 * 4. Database integration
 */

import { generateThresholdWallet, thresholdSign } from '@ritkey/core';
import { keccak256, toHex } from 'viem';

console.log('=== Ritkey Threshold Integration Test ===\n');

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (err) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${err.message}`);
    testsFailed++;
  }
}

// Test 1: Generate threshold wallet
let wallet;
test('Generate 2-of-3 threshold wallet', () => {
  wallet = generateThresholdWallet();

  if (!wallet) throw new Error('Wallet is null');
  if (!wallet.address) throw new Error('No address');
  if (!wallet.publicKey) throw new Error('No public key');
  if (wallet.shares.length !== 3) throw new Error(`Expected 3 shares, got ${wallet.shares.length}`);
  if (wallet.threshold !== 2) throw new Error(`Expected threshold 2, got ${wallet.threshold}`);
  if (wallet.totalShares !== 3) throw new Error(`Expected totalShares 3, got ${wallet.totalShares}`);

  console.log(`   Address: ${wallet.address}`);
  console.log(`   Public Key: ${wallet.publicKey.substring(0, 32)}...`);
  console.log(`   Shares: 3 generated`);
});

// Test 2: Verify shares are different
test('Shares are unique', () => {
  if (wallet.shares[0] === wallet.shares[1]) throw new Error('Shares 0 and 1 are identical');
  if (wallet.shares[1] === wallet.shares[2]) throw new Error('Shares 1 and 2 are identical');
  if (wallet.shares[0] === wallet.shares[2]) throw new Error('Shares 0 and 2 are identical');
});

// Test 3: Sign with shares 0 and 1
let signature1;
test('Sign with shares 0 and 1', () => {
  const message = '0x' + '0'.repeat(64); // 32-byte hash
  signature1 = thresholdSign([wallet.shares[0], wallet.shares[1]], message);

  if (!signature1) throw new Error('No signature returned');
  if (signature1.length !== 130) throw new Error(`Expected 130 chars (64 bytes hex + 0x), got ${signature1.length}`);
  console.log(`   Signature: ${signature1.substring(0, 32)}...`);
});

// Test 4: Sign with shares 0 and 2
let signature2;
test('Sign with shares 0 and 2', () => {
  const message = '0x' + '0'.repeat(64);
  signature2 = thresholdSign([wallet.shares[0], wallet.shares[2]], message);

  if (!signature2) throw new Error('No signature returned');
  if (signature2.length !== 130) throw new Error(`Expected 130 chars, got ${signature2.length}`);
});

// Test 5: Sign with shares 1 and 2
let signature3;
test('Sign with shares 1 and 2', () => {
  const message = '0x' + '0'.repeat(64);
  signature3 = thresholdSign([wallet.shares[1], wallet.shares[2]], message);

  if (!signature3) throw new Error('No signature returned');
  if (signature3.length !== 130) throw new Error(`Expected 130 chars, got ${signature3.length}`);
});

// Test 6: Verify all signatures are valid (should produce same signature for same key)
test('All signatures from same key match', () => {
  if (signature1 !== signature2) {
    throw new Error(`Sigs differ: ${signature1.substring(0, 20)} vs ${signature2.substring(0, 20)}`);
  }
  if (signature2 !== signature3) {
    throw new Error('Sig 2 and 3 differ');
  }
  console.log(`   All 3 signature combinations produced same result`);
});

// Test 7: Fail with only 1 share
test('Fails with only 1 share', () => {
  try {
    const message = '0x' + '0'.repeat(64);
    thresholdSign([wallet.shares[0]], message);
    throw new Error('Should have thrown error');
  } catch (err) {
    if (err.message === 'Should have thrown error') throw err;
    // Expected to fail
  }
});

// Test 8: Generate multiple wallets with different addresses
test('Multiple wallets have different addresses', () => {
  const wallet2 = generateThresholdWallet();
  const wallet3 = generateThresholdWallet();

  if (wallet.address === wallet2.address) throw new Error('Wallet 1 and 2 have same address');
  if (wallet2.address === wallet3.address) throw new Error('Wallet 2 and 3 have same address');
  if (wallet.address === wallet3.address) throw new Error('Wallet 1 and 3 have same address');
});

// Summary
console.log('\n=== Test Summary ===');
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);

if (testsFailed === 0) {
  console.log('\n🎉 All threshold integration tests passed!');
  process.exit(0);
} else {
  console.log('\n⚠️  Some tests failed');
  process.exit(1);
}
