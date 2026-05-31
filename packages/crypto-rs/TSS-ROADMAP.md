# TSS Implementation Roadmap

## Current Status

**Implemented:** Shamir's Secret Sharing (2-of-3 threshold)
- ✅ Threshold key generation
- ✅ Threshold signing with any 2 of 3 shares
- ✅ Memory-safe Rust implementation with zeroize
- ⚠️ **Limitation:** Still reconstructs the private key during signing

**Security Score:** ~6/10 (up from 4.1/10 with XOR)

## Phase 1: Shamir's Secret Sharing (CURRENT)

**What it does:**
- Splits private key into 3 shares using Shamir's Secret Sharing
- Any 2 shares can reconstruct the key
- Better than XOR: provides threshold recovery (lose 1 share, still works)
- Memory-safe: Rust with explicit zeroing

**Limitations:**
- Private key is reconstructed in memory during signing
- Not true MPC - still vulnerable to memory dumps

**Use case:** Development, testing, low-value wallets (<$1000)

## Phase 2: True TSS with GG20 (TODO)

**What it will do:**
- Distributed key generation (no trusted dealer)
- Threshold signing WITHOUT key reconstruction
- Each party computes signature share independently
- Shares combined to produce valid signature
- Private key NEVER exists in any single location

**Implementation:**
```rust
// Multi-round protocol
1. Keygen Round 1: Commitment phase
2. Keygen Round 2: Decommitment phase  
3. Keygen Round 3: VSS commitments
4. Keygen Round 4: Secret shares
5. Keygen Round 5: Verification

// Signing (2-of-3 parties)
1. Sign Round 1: Ephemeral key generation
2. Sign Round 2: Signature share computation
3. Sign Round 3: Share combination
```

**Challenges:**
- Multi-party-ecdsa library API complexity
- Requires coordination between parties
- Network communication for rounds
- State management across rounds

**Security Score:** 8-9/10

## Phase 3: Production Hardening (FUTURE)

**Additional improvements:**
- AWS KMS integration for encryption keys
- Hardware security module (HSM) support
- Secure enclaves (AWS Nitro, Intel SGX)
- Professional security audit
- Compliance certifications (SOC 2, ISO 27001)

**Security Score:** 9-10/10

## Comparison

| Feature | XOR (Old) | Shamir (Current) | GG20 TSS (Future) |
|---------|-----------|------------------|-------------------|
| **Threshold** | 2-of-2 | 2-of-3 | 2-of-3 (or t-of-n) |
| **Recovery** | ❌ No | ✅ Yes | ✅ Yes |
| **Key Reconstruction** | ✅ Yes | ✅ Yes | ❌ Never |
| **Memory Safety** | ❌ JS | ✅ Rust | ✅ Rust |
| **Security Score** | 4.1/10 | 6/10 | 8-9/10 |
| **Complexity** | Low | Medium | High |
| **Implementation** | ✅ Done | ✅ Done | ⏳ TODO |

## Recommendation

**For now:** Deploy Shamir's Secret Sharing
- Significant improvement over XOR (4.1 → 6/10)
- Adds threshold recovery
- Memory-safe implementation
- Production-ready for low-value use cases

**Next step:** Implement GG20 TSS
- Requires ~2-3 weeks of focused development
- Multi-round protocol implementation
- Coordination layer for distributed parties
- Comprehensive testing

**Timeline:**
- Phase 1 (Shamir): ✅ Complete
- Phase 2 (GG20 TSS): 2-3 weeks
- Phase 3 (Production): 1-2 months + audit

## References

- [Shamir's Secret Sharing](https://en.wikipedia.org/wiki/Shamir%27s_Secret_Sharing)
- [GG20 Paper](https://eprint.iacr.org/2020/540)
- [multi-party-ecdsa](https://github.com/ZenGo-X/multi-party-ecdsa)
- [Turnkey Security Model](https://www.turnkey.com/security)
