# Ritkey Security Upgrade - Implementation Plan

## 🎯 Goal
Upgrade Ritkey from 4.1/10 to 7-8/10 security score by implementing:
1. TSS (Threshold Signature Scheme)
2. t-of-n threshold recovery (2-of-3)
3. Rust crypto module
4. AWS KMS integration

---

## 📋 Phase 1: TSS Implementation (Days 1-3)

### Objective
Replace XOR 2-of-2 with proper threshold signatures using TSS library.

### Tasks

#### 1.1 Choose TSS Library
**Options:**
- `@tss-lib/tss` (Binance tss-lib Node.js wrapper)
- `tss-wasm` (WASM-compiled TSS)
- `multi-party-ecdsa` (Rust crate with Node bindings)

**Decision:** Use `multi-party-ecdsa` Rust crate with Node.js bindings
- Most mature
- Active development
- Good documentation
- Rust = memory safety

#### 1.2 Key Generation
```rust
// Generate 2-of-3 threshold keys
// Party 1: Server
// Party 2: Agent
// Party 3: Backup (optional recovery)

pub fn generate_threshold_keys(
    threshold: u16,
    parties: u16
) -> Result<Vec<KeyShare>, Error>
```

#### 1.3 Signing Without Reconstruction
```rust
// Sign with threshold (no full key reconstruction)
pub fn threshold_sign(
    shares: Vec<KeyShare>,
    message: &[u8]
) -> Result<Signature, Error>
```

#### 1.4 Database Schema
```sql
-- New tables for TSS
CREATE TABLE tss_key_shares (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  party_id INTEGER NOT NULL,
  share_data BLOB NOT NULL, -- Encrypted
  threshold INTEGER NOT NULL,
  total_parties INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (wallet_id) REFERENCES wallets(id)
);

CREATE TABLE tss_signing_sessions (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  message_hash TEXT NOT NULL,
  participants TEXT NOT NULL, -- JSON array
  signature TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## 📋 Phase 2: Threshold Recovery (Days 4-5)

### Objective
Implement 2-of-3 recovery mechanism.

### Tasks

#### 2.1 Key Share Distribution
```typescript
interface KeyShareDistribution {
  serverShare: EncryptedShare;    // Stored in DB
  agentShare: EncryptedShare;     // Given to agent
  backupShare: EncryptedShare;    // Stored separately or given to admin
}
```

#### 2.2 Recovery Flow
```typescript
// Recover wallet with 2 of 3 shares
async function recoverWallet(
  share1: KeyShare,
  share2: KeyShare,
  walletId: string
): Promise<RecoveredWallet>
```

#### 2.3 Recovery Policies
```typescript
interface RecoveryPolicy {
  requiredShares: number;
  timelock?: number;           // Optional delay
  approvers?: string[];        // Admin approval
  notificationEmail?: string;
}
```

---

## 📋 Phase 3: Rust Crypto Module (Days 6-8)

### Objective
Build memory-safe crypto operations in Rust.

### Tasks

#### 3.1 Rust Crate Structure
```
packages/crypto-rs/
├── Cargo.toml
├── src/
│   ├── lib.rs
│   ├── tss.rs          # TSS operations
│   ├── encryption.rs   # AES-GCM with zeroing
│   ├── signing.rs      # ECDSA signing
│   └── memory.rs       # Secure memory management
└── tests/
```

#### 3.2 Node.js Bindings
```rust
// Using neon or napi-rs
#[napi]
pub fn generate_keypair() -> Result<KeyPair> {
    // Rust implementation with memory zeroing
}

#[napi]
pub fn threshold_sign(
    shares: Vec<Buffer>,
    message: Buffer
) -> Result<Buffer> {
    // TSS signing
}
```

#### 3.3 Memory Safety
```rust
use zeroize::Zeroize;

pub struct SecretKey {
    key: Vec<u8>,
}

impl Drop for SecretKey {
    fn drop(&mut self) {
        self.key.zeroize(); // Explicit zeroing
    }
}
```

---

## 📋 Phase 4: AWS KMS Integration (Days 9-10)

### Objective
Use AWS KMS for encryption key management.

### Tasks

#### 4.1 KMS Setup
```typescript
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';

class KMSKeyManager {
  async encryptShare(share: Buffer): Promise<EncryptedShare> {
    // Use KMS to encrypt
  }
  
  async decryptShare(encrypted: EncryptedShare): Promise<Buffer> {
    // Use KMS to decrypt
  }
}
```

#### 4.2 Configuration
```bash
# Environment variables
AWS_KMS_KEY_ID=arn:aws:kms:us-east-1:123456789:key/...
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Or for development
USE_SOFTHSM=true
SOFTHSM_PIN=1234
```

#### 4.3 Key Rotation
```typescript
async function rotateEncryptionKey() {
  // 1. Generate new KMS key
  // 2. Re-encrypt all shares with new key
  // 3. Update database
  // 4. Retire old key
}
```

---

## 📋 Phase 5: Integration & Testing (Days 11-12)

### Tasks

#### 5.1 Update Core Package
```typescript
// packages/core/src/tss.ts
export {
  generateThresholdKeys,
  thresholdSign,
  recoverFromShares,
} from '../crypto-rs';
```

#### 5.2 Update Service
```typescript
// Replace old wallet creation
async function createWallet() {
  // Old: XOR splitting
  // New: TSS key generation
  const shares = await generateThresholdKeys(2, 3);
  
  // Store server share (encrypted with KMS)
  // Return agent share
  // Store backup share
}
```

#### 5.3 Migration Script
```typescript
// Migrate existing XOR wallets to TSS
async function migrateToTSS(walletId: string) {
  // 1. Reconstruct old key (one last time)
  // 2. Generate TSS shares
  // 3. Update database
  // 4. Zero old key
}
```

#### 5.4 Testing
```typescript
describe('TSS Wallet', () => {
  it('creates 2-of-3 threshold wallet', async () => {
    const wallet = await createTSSWallet();
    expect(wallet.threshold).toBe(2);
    expect(wallet.totalShares).toBe(3);
  });
  
  it('signs with 2 shares', async () => {
    const sig = await thresholdSign([share1, share2], message);
    expect(verifySignature(sig, message, publicKey)).toBe(true);
  });
  
  it('recovers wallet with 2 of 3 shares', async () => {
    const recovered = await recoverWallet(share1, share3);
    expect(recovered.address).toBe(originalAddress);
  });
  
  it('fails with only 1 share', async () => {
    await expect(thresholdSign([share1], message)).rejects.toThrow();
  });
});
```

---

## 📊 Expected Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| **Overall Security** | 4.1/10 | 7-8/10 | +95% |
| **Key Management** | 4/10 | 9/10 | +125% |
| **Cryptography** | 5/10 | 9/10 | +80% |
| **Recovery** | 2/10 | 8/10 | +300% |
| **Memory Safety** | 3/10 | 9/10 | +200% |
| **Encryption** | 6/10 | 9/10 | +50% |

---

## 🔧 Technical Stack

### New Dependencies
```json
{
  "dependencies": {
    "@aws-sdk/client-kms": "^3.x",
    "napi-rs": "^2.x",
    "zeroize": "^1.x" 
  },
  "devDependencies": {
    "cargo": "rust toolchain"
  }
}
```

### Rust Crates
```toml
[dependencies]
multi-party-ecdsa = "0.9"
curv = "0.10"
zeroize = "1.7"
napi = "2.16"
napi-derive = "2.16"
```

---

## 📝 Documentation Updates

1. **Security Model** - Document TSS architecture
2. **Recovery Guide** - How to recover with 2-of-3
3. **Migration Guide** - Upgrade from XOR to TSS
4. **KMS Setup** - AWS KMS configuration
5. **API Changes** - New wallet creation flow

---

## ⚠️ Breaking Changes

### Wallet Creation
```typescript
// Old
const { agentShard } = await createWallet();

// New
const { agentShare, backupShare } = await createTSSWallet({
  threshold: 2,
  totalShares: 3
});
```

### Signing
```typescript
// Old
await signTransaction(walletId, { agentShard, ... });

// New
await signTransaction(walletId, {
  shares: [agentShare], // Server provides its share automatically
  ...
});
```

---

## 🚀 Deployment Strategy

### Phase 1: Development (Week 1)
- Implement TSS in separate branch
- Test thoroughly
- No production deployment

### Phase 2: Staging (Week 2)
- Deploy to staging environment
- Create test wallets
- Performance testing
- Security review

### Phase 3: Migration (Week 3)
- Migrate existing wallets
- Dual-mode support (XOR + TSS)
- Gradual rollout

### Phase 4: Production (Week 4)
- Full TSS deployment
- Deprecate XOR mode
- Monitor and optimize

---

## 💰 Cost Estimate

### Development Time
- TSS Implementation: 3 days
- Threshold Recovery: 2 days
- Rust Module: 3 days
- KMS Integration: 2 days
- Testing & Integration: 2 days
- **Total: 12 days**

### Infrastructure
- AWS KMS: ~$1/month per key
- Additional compute: ~$10-20/month
- **Total: ~$15-25/month**

### Still Needed (External)
- Security Audit: $20k-50k
- Penetration Testing: $10k-20k
- **Total: $30k-70k**

---

## ✅ Success Criteria

1. ✅ No private key reconstruction in memory
2. ✅ 2-of-3 threshold signing works
3. ✅ Recovery with any 2 shares succeeds
4. ✅ All tests pass (>95% coverage)
5. ✅ KMS integration functional
6. ✅ Rust module has no memory leaks
7. ✅ Performance: <500ms per signature
8. ✅ Backward compatible (migration path)

---

## 🎯 Next Steps

Ready to start? I'll begin with:

1. **Day 1:** Set up Rust workspace + TSS library integration
2. **Day 2:** Implement threshold key generation
3. **Day 3:** Implement threshold signing

Shall I proceed?
