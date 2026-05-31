//! Threshold Secret Sharing Implementation
//!
//! Implements 2-of-3 threshold secret sharing using Shamir's Secret Sharing.
//! The private key is split into shares, and any 2 shares can reconstruct it.
//!
//! ## Integrity
//!
//! Plain Shamir over GF(256) has no integrity binding: a tampered share
//! silently reconstructs a *different* valid scalar. We mitigate this by:
//!   1. Embedding the wallet's public key in every share at split time.
//!   2. Cross-checking that all shares passed to recovery agree on the same
//!      public key (catches mismatched-wallet shares).
//!   3. After recovery, deriving the public key from the reconstructed scalar
//!      and comparing it to the expected public key (catches tampering).
//!   4. After split, round-trip-verifying that any 2-of-3 reconstructions
//!      produce the original key (catches library / arithmetic bugs).

use crate::error::{CryptoError, Result};
use napi::bindgen_prelude::*;
use rand::RngCore;
use secp256k1::{PublicKey, Secp256k1, SecretKey};
use serde::{Deserialize, Serialize};
use sharks::{Share, Sharks};
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Key share for threshold reconstruction
#[derive(Serialize, Deserialize, Clone)]
pub struct KeyShare {
    pub party_id: u8,
    pub threshold: u8,
    pub total_parties: u8,
    #[serde(with = "hex::serde")]
    pub share_data: Vec<u8>,
    pub public_key: String,
}

/// Generate threshold key shares using Shamir's Secret Sharing
///
/// # Arguments
/// * `threshold` - Minimum shares needed to reconstruct (e.g., 2)
/// * `total_parties` - Total number of shares (e.g., 3)
///
/// # Returns
/// Vector of key shares, one for each party
#[napi]
pub fn generate_threshold_keys_simple(threshold: u32, total_parties: u32) -> napi::Result<Vec<Buffer>> {
    if threshold == 0 || total_parties == 0 {
        return Err(CryptoError::InvalidThreshold(
            "Threshold and total parties must be > 0".to_string(),
        ).into());
    }

    if threshold > total_parties {
        return Err(CryptoError::InvalidThreshold(
            format!("Threshold {} cannot exceed total parties {}", threshold, total_parties),
        ).into());
    }

    if threshold > 255 || total_parties > 255 {
        return Err(CryptoError::InvalidThreshold(
            "Threshold and total parties must be <= 255".to_string(),
        ).into());
    }

    // Generate a random secp256k1 private key
    let secp = Secp256k1::new();
    let mut rng = rand::thread_rng();
    let secret_key = SecretKey::new(&mut rng);
    let public_key = PublicKey::from_secret_key(&secp, &secret_key);
    let public_key_hex = format!("0x{}", hex::encode(public_key.serialize()));

    // Get the private key bytes
    let secret_bytes = secret_key.secret_bytes();

    // Create Shamir's Secret Sharing scheme
    let sharks = Sharks(threshold as u8);
    let dealer = sharks.dealer(&secret_bytes);

    // Generate shares
    let shares: Vec<Share> = dealer.take(total_parties as usize).collect();

    // Convert to our KeyShare format
    let mut key_shares = Vec::new();
    for (idx, share) in shares.iter().enumerate() {
        let share_bytes: Vec<u8> = share.into();
        let key_share = KeyShare {
            party_id: (idx + 1) as u8,
            threshold: threshold as u8,
            total_parties: total_parties as u8,
            share_data: share_bytes,
            public_key: public_key_hex.clone(),
        };

        let serialized = serde_json::to_vec(&key_share)
            .map_err(|e| CryptoError::SerializationError(e.to_string()))?;

        key_shares.push(Buffer::from(serialized));
    }

    // Round-trip verification: confirm any 2 shares reconstruct the original key.
    if key_shares.len() >= threshold as usize {
        let test_shares: Vec<Buffer> = key_shares.iter().take(threshold as usize).cloned().collect();
        let recovered = verified_recover_secret(&test_shares)?;
        if recovered.as_slice() != &secret_bytes[..] {
            return Err(CryptoError::ThresholdError(
                "Keygen verification failed: recovered key differs from generated".into(),
            ).into());
        }
    }

    Ok(key_shares)
}

/// Reconstruct private key from threshold shares and sign
///
/// # Arguments
/// * `shares` - At least `threshold` key shares
/// * `message_hash` - Message hash to sign (32 bytes)
///
/// # Returns
/// ECDSA signature (64 bytes: r + s)
#[napi]
pub fn threshold_sign_simple(shares: Vec<Buffer>, message_hash: Buffer) -> napi::Result<Buffer> {
    if message_hash.len() != 32 {
        return Err(CryptoError::InvalidInput(
            "Message hash must be 32 bytes".to_string(),
        ).into());
    }

    // Reconstruct the secret with full integrity validation.
    // verified_recover_secret returns a zeroize-on-drop wrapper so the
    // raw bytes are scrubbed at end of scope even if signing fails.
    let secret = verified_recover_secret(&shares)?;

    let secret_key = SecretKey::from_slice(secret.as_slice())
        .map_err(|e| CryptoError::SigningError(format!("Invalid secret key: {}", e)))?;

    let secp = Secp256k1::new();
    let message = secp256k1::Message::from_digest_slice(&message_hash)
        .map_err(|e| CryptoError::SigningError(format!("Invalid message hash: {}", e)))?;

    let signature = secp.sign_ecdsa(&message, &secret_key);

    Ok(Buffer::from(signature.serialize_compact().to_vec()))
}

// ============================================================
// Internal: integrity-checked recovery
// ============================================================

/// Auto-zeroizing 32-byte secret wrapper.
#[derive(Zeroize, ZeroizeOnDrop)]
struct SecretBytes(Vec<u8>);

impl SecretBytes {
    fn as_slice(&self) -> &[u8] {
        &self.0
    }
}

/// Recover the secret from the provided shares with full integrity checks:
///   - all shares parse cleanly (no panic on malformed input)
///   - all shares agree on the same expected public key
///   - the reconstructed scalar derives back to that public key
///
/// Returns a zeroize-on-drop wrapper containing the 32-byte private key.
fn verified_recover_secret(shares: &[Buffer]) -> Result<SecretBytes> {
    if shares.is_empty() {
        return Err(CryptoError::InsufficientShares { needed: 2, got: 0 });
    }

    // 1. Deserialize all shares.
    let mut key_shares: Vec<KeyShare> = Vec::with_capacity(shares.len());
    for share_buf in shares {
        let share: KeyShare = serde_json::from_slice(share_buf)
            .map_err(|e| CryptoError::SerializationError(format!("malformed share: {}", e)))?;
        key_shares.push(share);
    }

    // 2. Threshold sanity.
    let threshold = key_shares[0].threshold as usize;
    if key_shares.len() < threshold {
        return Err(CryptoError::InsufficientShares {
            needed: threshold,
            got: key_shares.len(),
        });
    }

    // 3. All shares must agree on the expected public key.
    let expected_pubkey = key_shares[0].public_key.clone();
    if expected_pubkey.is_empty() {
        return Err(CryptoError::InvalidInput("share missing public_key".into()));
    }
    for s in &key_shares[1..] {
        if s.public_key != expected_pubkey {
            return Err(CryptoError::ThresholdError(
                "shares belong to different wallets (public_key mismatch)".into(),
            ));
        }
    }

    // 4. Parse share_data — fallible, no .unwrap() — and prevent duplicate
    //    party indices (sharks panics on duplicates in some versions).
    let mut seen_party_ids = std::collections::HashSet::new();
    let mut sharks_shares: Vec<Share> = Vec::with_capacity(key_shares.len());
    for ks in &key_shares {
        if !seen_party_ids.insert(ks.party_id) {
            return Err(CryptoError::InvalidInput(format!(
                "duplicate share party_id {}",
                ks.party_id
            )));
        }
        let s = Share::try_from(ks.share_data.as_slice()).map_err(|_| {
            CryptoError::InvalidInput("malformed Shamir share data".into())
        })?;
        sharks_shares.push(s);
    }

    // 5. Recover via Shamir.
    let sharks = Sharks(threshold as u8);
    let recovered: Vec<u8> = sharks
        .recover(&sharks_shares)
        .map_err(|e| CryptoError::ThresholdError(format!("Failed to recover secret: {:?}", e)))?;

    let secret = SecretBytes(recovered);

    if secret.0.len() != 32 {
        return Err(CryptoError::ThresholdError(format!(
            "Recovered secret has unexpected length: {}",
            secret.0.len()
        )));
    }

    // 6. Integrity check: derive pubkey from recovered scalar, compare to expected.
    let secret_key = SecretKey::from_slice(secret.as_slice()).map_err(|e| {
        CryptoError::ThresholdError(format!(
            "Recovered bytes are not a valid secp256k1 scalar — share tampering detected: {}",
            e
        ))
    })?;
    let secp = Secp256k1::new();
    let derived_pubkey = format!(
        "0x{}",
        hex::encode(PublicKey::from_secret_key(&secp, &secret_key).serialize())
    );

    if derived_pubkey != expected_pubkey {
        return Err(CryptoError::ThresholdError(
            "Reconstructed key does not match shares' public_key — share tampering detected"
                .into(),
        ));
    }

    Ok(secret)
}

/// Split an EXISTING private key into Shamir 2-of-3 shares
///
/// Used for importing existing wallets (e.g., from MetaMask) into Ritkey.
///
/// # Arguments
/// * `private_key` - 32-byte private key (hex without 0x prefix or with)
/// * `threshold` - Minimum shares needed to reconstruct (e.g., 2)
/// * `total_parties` - Total number of shares (e.g., 3)
///
/// # Returns
/// Vector of key shares, one for each party
#[napi]
pub fn split_existing_key(
    private_key: Buffer,
    threshold: u32,
    total_parties: u32,
) -> napi::Result<Vec<Buffer>> {
    if threshold == 0 || total_parties == 0 {
        return Err(CryptoError::InvalidThreshold(
            "Threshold and total parties must be > 0".to_string(),
        ).into());
    }

    if threshold > total_parties {
        return Err(CryptoError::InvalidThreshold(
            format!("Threshold {} cannot exceed total parties {}", threshold, total_parties),
        ).into());
    }

    if private_key.len() != 32 {
        return Err(CryptoError::InvalidInput(
            "Private key must be 32 bytes".to_string(),
        ).into());
    }

    // Parse private key
    let secret_key = SecretKey::from_slice(&private_key)
        .map_err(|e| CryptoError::InvalidInput(format!("Invalid private key: {}", e)))?;

    // Derive public key
    let secp = Secp256k1::new();
    let public_key = PublicKey::from_secret_key(&secp, &secret_key);
    let public_key_hex = format!("0x{}", hex::encode(public_key.serialize()));

    // Create Shamir's Secret Sharing scheme
    let sharks = Sharks(threshold as u8);
    let dealer = sharks.dealer(&private_key);

    // Generate shares
    let shares: Vec<Share> = dealer.take(total_parties as usize).collect();

    // Convert to our KeyShare format
    let mut key_shares = Vec::new();
    for (idx, share) in shares.iter().enumerate() {
        let share_bytes: Vec<u8> = share.into();
        let key_share = KeyShare {
            party_id: (idx + 1) as u8,
            threshold: threshold as u8,
            total_parties: total_parties as u8,
            share_data: share_bytes,
            public_key: public_key_hex.clone(),
        };

        let serialized = serde_json::to_vec(&key_share)
            .map_err(|e| CryptoError::SerializationError(e.to_string()))?;

        key_shares.push(Buffer::from(serialized));
    }

    // Round-trip verification: reconstruct from any 2 shares and confirm
    // we recover the original key. Catches library bugs / arithmetic errors
    // before we hand broken shares to a user (which would strand funds).
    if key_shares.len() >= threshold as usize {
        let test_shares: Vec<Buffer> = key_shares.iter().take(threshold as usize).cloned().collect();
        let recovered = verified_recover_secret(&test_shares)?;
        if recovered.as_slice() != private_key.as_ref() {
            return Err(CryptoError::ThresholdError(
                "Split verification failed: recovered key differs from original".into(),
            ).into());
        }
    }

    Ok(key_shares)
}

/// Reconstruct private key from threshold shares (for export)
///
/// WARNING: This exposes the private key in memory.
/// Used for exporting wallets to external apps (MetaMask, Rabby, etc.)
///
/// # Arguments
/// * `shares` - At least `threshold` key shares
///
/// # Returns
/// 32-byte private key
#[napi]
pub fn reconstruct_private_key(shares: Vec<Buffer>) -> napi::Result<Buffer> {
    // Use the verified helper — does pubkey-binding check + no panics on
    // malformed input. Returns a zeroize-on-drop wrapper that scrubs the
    // secret bytes when this function returns.
    let secret = verified_recover_secret(&shares)?;

    // Copy the recovered bytes into a Buffer to return to JS. The original
    // `secret` is dropped (and zeroized) at function end. We cannot zero
    // the returned Buffer — callers must scrub it themselves.
    Ok(Buffer::from(secret.as_slice().to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_threshold_keys() {
        let shares = generate_threshold_keys_simple(2, 3).unwrap();
        assert_eq!(shares.len(), 3);
    }

    #[test]
    fn test_split_existing_key() {
        // Generate a known private key
        let secp = Secp256k1::new();
        let mut rng = rand::thread_rng();
        let secret_key = SecretKey::new(&mut rng);
        let private_key_bytes = secret_key.secret_bytes();

        // Split it
        let shares = split_existing_key(
            Buffer::from(private_key_bytes.to_vec()),
            2,
            3,
        ).unwrap();

        assert_eq!(shares.len(), 3);

        // Reconstruct and verify
        let reconstructed = reconstruct_private_key(vec![shares[0].clone(), shares[1].clone()]).unwrap();
        assert_eq!(reconstructed.as_ref(), &private_key_bytes[..]);
    }

    #[test]
    fn test_reconstruct_with_any_2_shares() {
        let secp = Secp256k1::new();
        let mut rng = rand::thread_rng();
        let secret_key = SecretKey::new(&mut rng);
        let private_key_bytes = secret_key.secret_bytes();

        let shares = split_existing_key(
            Buffer::from(private_key_bytes.to_vec()),
            2,
            3,
        ).unwrap();

        // Test all 3 combinations
        let r1 = reconstruct_private_key(vec![shares[0].clone(), shares[1].clone()]).unwrap();
        let r2 = reconstruct_private_key(vec![shares[0].clone(), shares[2].clone()]).unwrap();
        let r3 = reconstruct_private_key(vec![shares[1].clone(), shares[2].clone()]).unwrap();

        assert_eq!(r1.as_ref(), &private_key_bytes[..]);
        assert_eq!(r2.as_ref(), &private_key_bytes[..]);
        assert_eq!(r3.as_ref(), &private_key_bytes[..]);
    }

    #[test]
    fn test_invalid_threshold() {
        let result = generate_threshold_keys_simple(3, 2);
        assert!(result.is_err());
    }

    #[test]
    fn test_threshold_sign() {
        let shares = generate_threshold_keys_simple(2, 3).unwrap();
        let message = Buffer::from(vec![1u8; 32]);

        // Sign with 2 shares
        let signature = threshold_sign_simple(vec![shares[0].clone(), shares[1].clone()], message);
        assert!(signature.is_ok());
        assert_eq!(signature.unwrap().len(), 64);
    }

    #[test]
    fn test_threshold_sign_with_different_shares() {
        let shares = generate_threshold_keys_simple(2, 3).unwrap();
        let message = Buffer::from(vec![1u8; 32]);

        // Sign with shares 0+1
        let sig1 = threshold_sign_simple(vec![shares[0].clone(), shares[1].clone()], message.clone()).unwrap();

        // Sign with shares 1+2
        let sig2 = threshold_sign_simple(vec![shares[1].clone(), shares[2].clone()], message.clone()).unwrap();

        // Both should produce valid signatures (they'll be different due to nonce randomness)
        assert_eq!(sig1.len(), 64);
        assert_eq!(sig2.len(), 64);
    }

    #[test]
    fn test_insufficient_shares() {
        let shares = generate_threshold_keys_simple(2, 3).unwrap();
        let message = Buffer::from(vec![1u8; 32]);

        // Try to sign with only 1 share
        let result = threshold_sign_simple(vec![shares[0].clone()], message);
        assert!(result.is_err());
    }
}
