#!/usr/bin/env node
/**
 * Integration test for wallet import/export functionality
 */

import {
  generateThresholdWallet,
  thresholdSign,
  importPrivateKey,
  exportPrivateKey,
} from '@ritkey/core';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak256, getAddress } from 'viem';

console.log('=== Ritkey Import/Export Test ===\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name}: ${err.message}`);
    failed++;
  }
}

// Test 1: Generate wallet, export key, verify match
test('Export key from threshold wallet', () => {
  const wallet = generateThresholdWallet();
  const privateKey = exportPrivateKey([wallet.shares[0], wallet.shares[1]]);

  if (!privateKey.startsWith('0x')) throw new Error('Missing 0x prefix');
  if (privateKey.length !== 66) throw new Error(`Expected 66 chars, got ${privateKey.length}`);

  // Verify the exported key derives to the same address
  const keyBytes = Buffer.from(privateKey.slice(2), 'hex');
  const pubKey = secp256k1.getPublicKey(keyBytes, false);
  const pubKeyNoPrefix = pubKey.slice(1);
  const hash = keccak256(`0x${Buffer.from(pubKeyNoPrefix).toString('hex')}`);
  const address = getAddress(`0x${hash.slice(26)}`);

  if (address !== wallet.address) {
    throw new Error(`Address mismatch: ${address} vs ${wallet.address}`);
  }

  console.log(`   Original address:  ${wallet.address}`);
  console.log(`   Exported key:      ${privateKey.substring(0, 20)}...`);
  console.log(`   Derived address:   ${address}`);
});

// Test 2: Import private key, verify same address
test('Import existing private key', () => {
  // Generate a fresh private key (as if from MetaMask)
  const originalKey = secp256k1.utils.randomPrivateKey();
  const originalKeyHex = `0x${Buffer.from(originalKey).toString('hex')}`;

  // Derive expected address
  const pubKey = secp256k1.getPublicKey(originalKey, false);
  const pubKeyNoPrefix = pubKey.slice(1);
  const hash = keccak256(`0x${Buffer.from(pubKeyNoPrefix).toString('hex')}`);
  const expectedAddress = getAddress(`0x${hash.slice(26)}`);

  // Import into Ritkey
  const imported = importPrivateKey(originalKeyHex);

  if (imported.address !== expectedAddress) {
    throw new Error(`Address mismatch: ${imported.address} vs ${expectedAddress}`);
  }

  if (imported.shares.length !== 3) {
    throw new Error(`Expected 3 shares, got ${imported.shares.length}`);
  }

  console.log(`   Original key:      ${originalKeyHex.substring(0, 20)}...`);
  console.log(`   Expected address:  ${expectedAddress}`);
  console.log(`   Imported address:  ${imported.address}`);
  console.log(`   Shares generated:  3`);
});

// Test 3: Full round-trip (import → export same key)
test('Round-trip: import → export → same key', () => {
  const originalKey = secp256k1.utils.randomPrivateKey();
  const originalKeyHex = `0x${Buffer.from(originalKey).toString('hex')}`;

  // Import
  const imported = importPrivateKey(originalKeyHex);

  // Export with any 2 of 3 shares
  const exported = exportPrivateKey([imported.shares[0], imported.shares[2]]);

  if (exported.toLowerCase() !== originalKeyHex.toLowerCase()) {
    throw new Error(`Key mismatch:\n  Original: ${originalKeyHex}\n  Exported: ${exported}`);
  }

  console.log(`   ✓ Round-trip preserved private key`);
});

// Test 4: Sign with imported wallet
test('Sign with imported wallet shares', () => {
  const originalKey = secp256k1.utils.randomPrivateKey();
  const originalKeyHex = `0x${Buffer.from(originalKey).toString('hex')}`;

  const imported = importPrivateKey(originalKeyHex);

  const messageHash = '0x' + '0'.repeat(64);
  const sig1 = thresholdSign([imported.shares[0], imported.shares[1]], messageHash);
  const sig2 = thresholdSign([imported.shares[1], imported.shares[2]], messageHash);

  if (sig1 !== sig2) {
    throw new Error('Signatures should match (same key)');
  }

  console.log(`   Signature: ${sig1.substring(0, 32)}...`);
});

// Test 5: Reject invalid private key
test('Reject invalid private key on import', () => {
  try {
    importPrivateKey('not-a-key');
    throw new Error('Should have rejected');
  } catch (err) {
    if (err.message === 'Should have rejected') throw err;
    // Expected
  }
});

// Test 6: Reject single share on export
test('Reject single share on export', () => {
  const wallet = generateThresholdWallet();
  try {
    exportPrivateKey([wallet.shares[0]]);
    throw new Error('Should have rejected');
  } catch (err) {
    if (err.message === 'Should have rejected') throw err;
    // Expected
  }
});

// Test 7: Export with backup share works (any 2 of 3)
test('Export with agent + backup shares (skip server)', () => {
  const wallet = generateThresholdWallet();

  // Use shares 1 (agent) + 2 (backup), skip 0 (server)
  const exported = exportPrivateKey([wallet.shares[1], wallet.shares[2]]);

  // Verify it works by re-importing
  const reimported = importPrivateKey(exported);
  if (reimported.address !== wallet.address) {
    throw new Error('Address mismatch after export with agent+backup');
  }

  console.log(`   ✓ Agent + Backup shares can export (recovery scenario works)`);
});

// Summary
console.log('\n=== Test Summary ===');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);

if (failed === 0) {
  console.log('\n🎉 All import/export tests passed!');
  console.log('\n📝 Ritkey now works like a real wallet:');
  console.log('   ✓ Users can export private key for MetaMask/Rabby');
  console.log('   ✓ Users can import existing private keys');
  console.log('   ✓ Recovery works with any 2 of 3 shares');
  process.exit(0);
} else {
  process.exit(1);
}
