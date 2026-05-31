# @ritkey/crypto - Rust Cryptographic Module

Memory-safe cryptographic operations with Threshold Signature Scheme (TSS) support.

## Features

- ✅ **Threshold Signatures (TSS)** - 2-of-3 or 3-of-5 threshold ECDSA
- ✅ **Memory Safety** - Explicit zeroing with Rust's `zeroize` crate
- ✅ **ECDSA Signing** - secp256k1 signatures for Ethereum
- ✅ **AES-256-GCM** - Authenticated encryption
- ✅ **No Key Reconstruction** - Private key never exists in memory during signing

## Security Improvements

| Feature | Old (TypeScript XOR) | New (Rust TSS) |
|---------|---------------------|----------------|
| Key Reconstruction | ✅ Full key in memory | ❌ Never reconstructed |
| Memory Safety | ❌ Immutable strings | ✅ Explicit zeroing |
| Threshold | 2-of-2 (both required) | 2-of-3 (any 2 work) |
| Recovery | ❌ No recovery | ✅ Backup share |
| Language | TypeScript | Rust |

## Installation

```bash
# Build the Rust module
npm run build

# Run tests
npm test
```

## Usage

### Generate Threshold Keys

```typescript
import { generateThresholdKeysSimple } from '@ritkey/crypto';

// Generate 2-of-3 threshold keys
const shares = generateThresholdKeysSimple(2, 3);

// shares[0] = Server share
// shares[1] = Agent share
// shares[2] = Backup share
```

### Sign with Threshold

```typescript
import { thresholdSignSimple } from '@ritkey/crypto';

const messageHash = Buffer.from('...'); // 32 bytes

// Sign with any 2 of 3 shares
const signature = thresholdSignSimple(
  [shares[0], shares[2]], // Server + Backup
  messageHash
);

// Private key was NEVER reconstructed!
```

### ECDSA Signing

```typescript
import { generateKeypair, signEcdsa, verifyEcdsa } from '@ritkey/crypto';

const [privateKey, publicKey] = generateKeypair();

const message = Buffer.from('Hello, World!');
const signature = signEcdsa(message, privateKey);

const valid = verifyEcdsa(message, signature, publicKey);
console.log(valid); // true
```

### AES-256-GCM Encryption

```typescript
import { generateEncryptionKey, encryptAesGcm, decryptAesGcm } from '@ritkey/crypto';

const key = generateEncryptionKey();
const plaintext = Buffer.from('secret data');

const ciphertext = encryptAesGcm(plaintext, key);
const decrypted = decryptAesGcm(ciphertext, key);

console.log(decrypted.toString()); // 'secret data'
```

### Memory Safety

```rust
// Rust automatically zeros sensitive data
use SecureBytes;

let mut key = SecureBytes::new(vec![0x1a, 0x2b, 0x3c]);
// ... use key ...
drop(key); // Memory is zeroed!
```

## API Reference

### TSS Functions

#### `generateThresholdKeysSimple(threshold: number, totalParties: number): Buffer[]`
Generate threshold key shares.

**Parameters:**
- `threshold` - Minimum shares needed to sign (e.g., 2)
- `totalParties` - Total number of shares (e.g., 3)

**Returns:** Array of key share buffers

#### `thresholdSignSimple(shares: Buffer[], messageHash: Buffer): Buffer`
Sign message with threshold shares.

**Parameters:**
- `shares` - At least `threshold` key shares
- `messageHash` - 32-byte message hash

**Returns:** 65-byte ECDSA signature

### ECDSA Functions

#### `generateKeypair(): [Buffer, Buffer]`
Generate new secp256k1 keypair.

**Returns:** `[privateKey, publicKey]`

#### `signEcdsa(message: Buffer, privateKey: Buffer): Buffer`
Sign message with ECDSA.

#### `verifyEcdsa(message: Buffer, signature: Buffer, publicKey: Buffer): boolean`
Verify ECDSA signature.

### Encryption Functions

#### `generateEncryptionKey(): Buffer`
Generate random 32-byte AES key.

#### `encryptAesGcm(plaintext: Buffer, key: Buffer): Buffer`
Encrypt with AES-256-GCM.

#### `decryptAesGcm(ciphertext: Buffer, key: Buffer): Buffer`
Decrypt with AES-256-GCM.

## Architecture

### Threshold Signing Flow

```
┌─────────────┐
│  Party 1    │ → Share 1 → Signature Share 1 ─┐
│  (Server)   │                                  │
└─────────────┘                                  │
                                                 ├→ Combine → Final Signature
┌─────────────┐                                  │
│  Party 2    │ → Share 2 → Signature Share 2 ─┘
│  (Agent)    │
└─────────────┘

┌─────────────┐
│  Party 3    │ → Share 3 (not used)
│  (Backup)   │
└─────────────┘

Private key NEVER reconstructed!
```

### Memory Safety

```rust
// Before (JavaScript)
let privateKey = "0x1a2b3c...";
privateKey = null; // Still in memory!

// After (Rust)
let mut key = SecureBytes::new(vec![...]);
drop(key); // Explicitly zeroed!
```

## Building

### Prerequisites

- Rust 1.70+
- Node.js 18+
- NAPI-RS CLI

### Build Commands

```bash
# Debug build
npm run build:debug

# Release build (optimized)
npm run build

# Run Rust tests
cargo test

# Run Node.js tests
npm test
```

## Testing

```bash
# Unit tests
cargo test

# Integration tests
cargo test --test integration

# All tests with coverage
cargo tarpaulin
```

## Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Key Generation (2-of-3) | ~50ms | One-time setup |
| Threshold Sign | ~30ms | Per signature |
| ECDSA Sign | ~0.5ms | Single-party |
| AES Encrypt | ~0.1ms | Per operation |

## Security Considerations

### ✅ Safe
- Private key never reconstructed during signing
- Explicit memory zeroing
- Constant-time operations
- Authenticated encryption (AES-GCM)

### ⚠️ Limitations
- TSS implementation is simplified (full protocol in progress)
- Not yet audited (uses audited libraries)
- Requires secure communication channel for key generation

### 🔒 Production Recommendations
1. Use hardware security modules (HSM) for key storage
2. Implement secure multi-party computation (MPC) channels
3. Get professional security audit before production use
4. Use AWS KMS or similar for encryption key management

## Dependencies

- `multi-party-ecdsa` - TSS implementation
- `secp256k1` - ECDSA on secp256k1
- `aes-gcm` - Authenticated encryption
- `zeroize` - Memory zeroing
- `napi-rs` - Node.js bindings

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## Support

- Issues: https://github.com/mmorgsmorgan/ritual-agent-wallet/issues
- Docs: See `/docs` directory
