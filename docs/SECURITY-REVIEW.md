# Ritkey Security Review & Turnkey Comparison

## Executive Summary

**Ritkey** is a self-hosted MPC wallet system using XOR 2-of-2 key splitting, designed for AI agents on Ritual Chain. While functional for development and internal tools, it has **significant security limitations** compared to production-grade solutions like Turnkey.

**Recommendation:** Ritkey is suitable for:
- ✅ Development and testing
- ✅ Internal tools with low-value transactions
- ✅ Proof-of-concept deployments
- ❌ **NOT recommended for production with significant funds**

For production use cases, consider:
1. **Turnkey** - Production-grade TSS MPC
2. **Lit Protocol** - Decentralized MPC
3. **Fireblocks** - Enterprise custody
4. Or upgrade Ritkey to use audited TSS libraries

---

## Security Architecture Comparison

### Ritkey (Current Implementation)

**Key Management:**
- **Algorithm:** XOR 2-of-2 splitting
- **Formula:** `privateKey = serverShard XOR agentShard`
- **Encryption:** AES-256-GCM for server shard at rest
- **Storage:** SQLite database (self-hosted)

**Signing Process:**
1. Agent provides `agentShard`
2. Server decrypts `serverShard`
3. Reconstruct: `privateKey = serverShard XOR agentShard`
4. Sign transaction with full private key
5. Zero out private key in memory (best effort)

### Turnkey

**Key Management:**
- **Algorithm:** Threshold Signature Scheme (TSS) - GG20/CGGMP21
- **Shares:** Distributed across multiple secure enclaves
- **Encryption:** Hardware-backed encryption (AWS Nitro Enclaves)
- **Storage:** Distributed, no single point of failure

**Signing Process:**
1. Client initiates signing request
2. Multiple parties compute signature shares
3. Shares combined to produce valid signature
4. **Private key never reconstructed**

---

## Critical Security Differences

### 1. Key Reconstruction

| Aspect | Ritkey | Turnkey |
|--------|--------|---------|
| **Private Key Reconstruction** | ✅ Full key reconstructed in memory | ❌ Never reconstructed |
| **Attack Surface** | Server memory dump = key compromise | Distributed, no single point |
| **Memory Safety** | JavaScript (can't zero strings) | Hardware enclaves |

**Risk:** Ritkey reconstructs the full private key in server memory during every signing operation. A memory dump, debugger, or side-channel attack could extract the key.

**Turnkey:** Uses TSS - signature shares are computed independently and combined. The private key never exists in any single location.

### 2. Cryptographic Strength

| Aspect | Ritkey | Turnkey |
|--------|--------|---------|
| **MPC Type** | XOR 2-of-2 | TSS (GG20/CGGMP21) |
| **Threshold** | 2-of-2 (both required) | t-of-n (flexible) |
| **Audited** | ❌ No | ✅ Yes (multiple audits) |
| **Standards** | Custom implementation | Industry standard |

**Risk:** XOR splitting is simple but not a true MPC protocol. It's essentially "split the key in half" rather than threshold cryptography.

**Turnkey:** Uses audited TSS implementations (Binance tss-lib, CGGMP21) with formal security proofs.

### 3. Key Recovery

| Aspect | Ritkey | Turnkey |
|--------|--------|---------|
| **Shard Loss** | Lose either shard = funds lost | Threshold recovery (t-of-n) |
| **Backup** | Agent must backup shard | Distributed backup |
| **Recovery** | ❌ No recovery mechanism | ✅ Policy-based recovery |

**Risk:** Ritkey is 2-of-2 - lose either shard and the wallet is permanently unrecoverable.

**Turnkey:** Supports t-of-n schemes (e.g., 2-of-3) - lose one share, still recoverable.

### 4. Infrastructure Security

| Aspect | Ritkey | Turnkey |
|--------|--------|---------|
| **Hosting** | Self-hosted (user responsibility) | AWS Nitro Enclaves |
| **Isolation** | Process-level | Hardware-level (TEE) |
| **Attestation** | ❌ None | ✅ Remote attestation |
| **Compliance** | User responsibility | SOC 2, ISO 27001 |

**Risk:** Ritkey runs in a standard Node.js process. No hardware isolation, no attestation, vulnerable to host compromise.

**Turnkey:** Runs in AWS Nitro Enclaves (Trusted Execution Environment) with remote attestation.

### 5. Encryption at Rest

| Aspect | Ritkey | Turnkey |
|--------|--------|---------|
| **Algorithm** | AES-256-GCM | Hardware-backed KMS |
| **Key Storage** | Environment variable | AWS KMS / HSM |
| **Key Rotation** | Manual | Automated |
| **Audit** | ❌ No | ✅ Yes |

**Risk:** Ritkey's encryption key is in an environment variable. If the server is compromised, the key is exposed.

**Turnkey:** Uses AWS KMS with hardware security modules (HSMs) and automatic key rotation.

### 6. Authentication

| Aspect | Ritkey | Turnkey |
|--------|--------|---------|
| **Method** | P-256 API keys | P-256 API keys |
| **Replay Protection** | 5-minute window | Similar |
| **Rate Limiting** | Basic | Advanced |
| **Audit Logging** | Basic | Comprehensive |

**Similar:** Both use P-256 signature-based authentication. Ritkey's implementation is reasonable here.

### 7. Sybil Resistance

| Aspect | Ritkey | Turnkey |
|--------|--------|---------|
| **Mechanism** | 1 wallet per API key | Policy-based |
| **Faucet** | 1 drip per wallet | N/A (no faucet) |
| **Enforcement** | Database constraints | API policies |

**Similar:** Both enforce limits, but Turnkey has more sophisticated policy engines.

---

## Vulnerability Analysis

### Critical Vulnerabilities

#### 1. **Memory Exposure** (HIGH)
```typescript
// Ritkey reconstructs full key in memory
const privateKey = reconstructKey(serverShard, agentShard);
const signature = sign(privateKey, message);
// privateKey exists in memory as immutable string
```

**Attack Vectors:**
- Memory dump (debugger, core dump)
- Side-channel attacks (timing, cache)
- Process inspection
- Swap file exposure

**Mitigation:** Use TSS (never reconstruct key) or hardware enclaves.

#### 2. **Single Point of Failure** (HIGH)
- Server compromise = all server shards exposed
- Database compromise = all encrypted shards exposed
- Encryption key compromise = all shards decrypted

**Mitigation:** Distribute trust across multiple parties (TSS).

#### 3. **No Key Recovery** (MEDIUM)
- Lose agent shard = funds lost forever
- No backup mechanism
- No recovery policy

**Mitigation:** Implement t-of-n threshold (e.g., 2-of-3).

#### 4. **JavaScript Memory Management** (MEDIUM)
```typescript
// JavaScript strings are immutable - can't zero
let privateKey = "0x1a2b3c...";
privateKey = null; // String still in memory until GC
```

**Attack Vectors:**
- Heap inspection before garbage collection
- Memory forensics

**Mitigation:** Use native code (Rust, C++) with explicit memory zeroing.

#### 5. **Faucet Drainage** (MEDIUM)
- Single private key controls faucet
- No daily cap implemented yet (TODO)
- Compromise = drain faucet

**Mitigation:** Implement Layer F (daily cap), use dedicated faucet wallet.

### Medium Vulnerabilities

#### 6. **SQLite Injection** (MEDIUM)
- Uses parameterized queries (good)
- But SQLite file is readable if server compromised

**Mitigation:** Encrypt entire database, use PostgreSQL with row-level security.

#### 7. **No Hardware Security** (MEDIUM)
- No HSM support
- No TPM integration
- No secure enclave

**Mitigation:** Add HSM support for production deployments.

#### 8. **Limited Audit Trail** (LOW)
- Basic audit logging
- No tamper-proof logs
- No external monitoring

**Mitigation:** Add immutable audit logs, external SIEM integration.

---

## Security Scorecard

| Category | Ritkey | Turnkey | Notes |
|----------|--------|---------|-------|
| **Key Management** | 4/10 | 10/10 | XOR vs TSS |
| **Cryptography** | 5/10 | 10/10 | Custom vs audited |
| **Infrastructure** | 3/10 | 10/10 | Self-hosted vs TEE |
| **Recovery** | 2/10 | 9/10 | No recovery vs t-of-n |
| **Compliance** | 2/10 | 10/10 | None vs SOC 2 |
| **Audit Trail** | 5/10 | 9/10 | Basic vs comprehensive |
| **Authentication** | 7/10 | 9/10 | P-256 (both good) |
| **Encryption** | 6/10 | 10/10 | AES-256 vs HSM |
| **Memory Safety** | 3/10 | 10/10 | JS vs hardware |
| **Attack Surface** | 4/10 | 9/10 | Large vs minimal |
| **Overall** | **4.1/10** | **9.6/10** | |

---

## Cost Comparison

### Ritkey
- **Setup:** Free (open source)
- **Hosting:** $5-50/month (VPS)
- **Maintenance:** Developer time
- **Audits:** $0 (none)
- **Total:** ~$100-500/month

### Turnkey
- **Setup:** Free (API)
- **Per-wallet:** $0.10-1.00/month
- **Transactions:** $0.01-0.10 each
- **Support:** Included
- **Audits:** Included
- **Total:** $100-1000+/month (depends on usage)

**Trade-off:** Ritkey is cheaper but requires security expertise. Turnkey is more expensive but production-ready.

---

## Recommendations

### For Development/Testing
✅ **Use Ritkey**
- Fast iteration
- Full control
- No external dependencies
- Cost-effective

### For Production (Low Value)
⚠️ **Use Ritkey with caution**
- Max $100-1000 per wallet
- Internal tools only
- Accept risk of key loss
- Implement all security layers (F, C, A)

### For Production (High Value)
❌ **Do NOT use Ritkey**
✅ **Use Turnkey or similar**
- Audited cryptography
- Hardware security
- Professional support
- Compliance certifications

### Upgrade Path for Ritkey

To make Ritkey production-ready:

1. **Replace XOR with TSS** (CRITICAL)
   - Use Binance tss-lib or CGGMP21
   - Implement t-of-n threshold
   - Never reconstruct private key

2. **Add Hardware Security** (HIGH)
   - HSM integration (AWS CloudHSM, YubiHSM)
   - TPM support
   - Secure enclave (AWS Nitro, Intel SGX)

3. **Improve Memory Safety** (HIGH)
   - Rewrite crypto in Rust/C++
   - Explicit memory zeroing
   - Constant-time operations

4. **Security Audit** (HIGH)
   - Professional cryptography audit
   - Penetration testing
   - Code review

5. **Add Recovery** (MEDIUM)
   - Implement 2-of-3 or 3-of-5 threshold
   - Backup shard distribution
   - Policy-based recovery

6. **Compliance** (MEDIUM)
   - SOC 2 Type II
   - ISO 27001
   - GDPR compliance

**Estimated Cost:** $50,000-200,000 for full production upgrade

---

## Conclusion

### Ritkey Strengths
✅ Simple and understandable
✅ Self-hosted (privacy, control)
✅ Open source (auditable)
✅ Cost-effective for development
✅ Good for learning MPC concepts

### Ritkey Weaknesses
❌ XOR splitting (not true MPC)
❌ Key reconstruction in memory
❌ No hardware security
❌ No recovery mechanism
❌ Not audited
❌ JavaScript memory limitations

### When to Use Each

**Use Ritkey:**
- Development and testing
- Internal tools (<$1000/wallet)
- Learning and experimentation
- When you need full control

**Use Turnkey:**
- Production applications
- High-value wallets (>$1000)
- Compliance requirements
- When security is critical

### Final Verdict

**Ritkey:** 4.1/10 security score
- Good for development
- Not production-ready
- Needs significant upgrades for real-world use

**Turnkey:** 9.6/10 security score
- Production-grade
- Industry standard
- Worth the cost for serious applications

---

## References

- [Binance TSS Library](https://github.com/bnb-chain/tss-lib)
- [CGGMP21 Paper](https://eprint.iacr.org/2021/060)
- [AWS Nitro Enclaves](https://aws.amazon.com/ec2/nitro/nitro-enclaves/)
- [Turnkey Security](https://www.turnkey.com/security)
- [OWASP Cryptographic Storage](https://owasp.org/www-project-top-ten/)
