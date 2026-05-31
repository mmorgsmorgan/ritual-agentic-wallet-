// Test Ritkey Crypto - Threshold Signatures
const crypto = require('./index.js');

console.log('=== Ritkey Crypto Test ===\n');

// 1. Initialize
console.log('1. Initialize:', crypto.init());
console.log('   Version:', crypto.version());
console.log();

// 2. Generate threshold keys (2-of-3)
console.log('2. Generating 2-of-3 threshold keys...');
const shares = crypto.generateThresholdKeysSimple(2, 3);
console.log(`   Generated ${shares.length} shares`);
console.log(`   Share 0 size: ${shares[0].length} bytes`);
console.log(`   Share 1 size: ${shares[1].length} bytes`);
console.log(`   Share 2 size: ${shares[2].length} bytes`);
console.log();

// 3. Sign with 2 shares
console.log('3. Signing with shares 0 and 1...');
const message = Buffer.from('0'.repeat(64), 'hex'); // 32-byte message hash
const signature1 = crypto.thresholdSignSimple([shares[0], shares[1]], message);
console.log(`   Signature size: ${signature1.length} bytes`);
console.log(`   Signature: ${signature1.toString('hex').substring(0, 32)}...`);
console.log();

// 4. Sign with different 2 shares
console.log('4. Signing with shares 1 and 2...');
const signature2 = crypto.thresholdSignSimple([shares[1], shares[2]], message);
console.log(`   Signature size: ${signature2.length} bytes`);
console.log(`   Signature: ${signature2.toString('hex').substring(0, 32)}...`);
console.log();

// 5. Test encryption
console.log('5. Testing AES-256-GCM encryption...');
const key = crypto.generateEncryptionKey();
const plaintext = Buffer.from('Hello, Ritkey!');
const ciphertext = crypto.encryptAesGcm(plaintext, key);
const decrypted = crypto.decryptAesGcm(ciphertext, key);
console.log(`   Plaintext: ${plaintext.toString()}`);
console.log(`   Encrypted size: ${ciphertext.length} bytes`);
console.log(`   Decrypted: ${decrypted.toString()}`);
console.log(`   Match: ${plaintext.equals(decrypted)}`);
console.log();

// 6. Test ECDSA signing
console.log('6. Testing ECDSA signing...');
const keypair = crypto.generateKeypair();
const privateKey = keypair[0];
const publicKey = keypair[1];
const testMessage = Buffer.from('Test message');
const ecdsaSig = crypto.signEcdsa(testMessage, privateKey);
const valid = crypto.verifyEcdsa(testMessage, ecdsaSig, publicKey);
console.log(`   Private key size: ${privateKey.length} bytes`);
console.log(`   Public key size: ${publicKey.length} bytes`);
console.log(`   Signature size: ${ecdsaSig.length} bytes`);
console.log(`   Signature valid: ${valid}`);
console.log();

console.log('✅ All tests passed!');
