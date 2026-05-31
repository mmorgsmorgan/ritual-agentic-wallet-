//! ECDSA signing on secp256k1

use crate::error::CryptoError;
use crate::memory::SecureBytes;
use napi::bindgen_prelude::*;
use secp256k1::{ecdsa::Signature, Message, PublicKey, Secp256k1, SecretKey};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

/// Sign message with ECDSA (secp256k1)
///
/// # Arguments
/// * `message` - Message to sign (will be hashed with SHA256)
/// * `private_key` - 32-byte private key
///
/// # Returns
/// 65-byte signature (r + s + v)
#[napi]
pub fn sign_ecdsa(message: Buffer, private_key: Buffer) -> napi::Result<Buffer> {
    if private_key.len() != 32 {
        return Err(CryptoError::SigningError(
            "Private key must be 32 bytes".to_string(),
        ).into());
    }

    let secp = Secp256k1::new();

    // Parse private key
    let secret_key = SecretKey::from_slice(&private_key)
        .map_err(|e| CryptoError::SigningError(e.to_string()))?;

    // Hash message
    let mut hasher = Sha256::new();
    hasher.update(&message);
    let message_hash = hasher.finalize();

    // Create message
    let msg = Message::from_digest_slice(&message_hash)
        .map_err(|e| CryptoError::SigningError(e.to_string()))?;

    // Sign
    let signature = secp.sign_ecdsa(&msg, &secret_key);

    // Serialize signature (64 bytes: r + s)
    let sig_bytes = signature.serialize_compact();

    // Add recovery ID (v)
    let mut result = Vec::with_capacity(65);
    result.extend_from_slice(&sig_bytes);
    result.push(0); // Recovery ID placeholder

    Ok(Buffer::from(result))
}

/// Verify ECDSA signature
///
/// # Arguments
/// * `message` - Original message
/// * `signature` - 65-byte signature
/// * `public_key` - 33 or 65 byte public key
///
/// # Returns
/// true if signature is valid
#[napi]
pub fn verify_ecdsa(message: Buffer, signature: Buffer, public_key: Buffer) -> napi::Result<bool> {
    if signature.len() != 65 {
        return Err(CryptoError::SigningError(
            "Signature must be 65 bytes".to_string(),
        ).into());
    }

    let secp = Secp256k1::new();

    // Parse public key
    let pubkey = PublicKey::from_slice(&public_key)
        .map_err(|e| CryptoError::SigningError(e.to_string()))?;

    // Hash message
    let mut hasher = Sha256::new();
    hasher.update(&message);
    let message_hash = hasher.finalize();

    // Create message
    let msg = Message::from_digest_slice(&message_hash)
        .map_err(|e| CryptoError::SigningError(e.to_string()))?;

    // Parse signature (ignore recovery ID)
    let sig = Signature::from_compact(&signature[..64])
        .map_err(|e| CryptoError::SigningError(e.to_string()))?;

    // Verify
    Ok(secp.verify_ecdsa(&msg, &sig, &pubkey).is_ok())
}

/// Generate secp256k1 keypair
///
/// # Returns
/// (private_key, public_key)
#[napi]
pub fn generate_keypair() -> napi::Result<Vec<Buffer>> {
    let secp = Secp256k1::new();
    let (secret_key, public_key) = secp.generate_keypair(&mut rand::thread_rng());

    let private_key = Buffer::from(secret_key.secret_bytes().to_vec());
    let public_key_bytes = Buffer::from(public_key.serialize().to_vec());

    Ok(vec![private_key, public_key_bytes])
}

/// Derive public key from private key
#[napi]
pub fn derive_public_key(private_key: Buffer) -> napi::Result<Buffer> {
    if private_key.len() != 32 {
        return Err(CryptoError::SigningError(
            "Private key must be 32 bytes".to_string(),
        ).into());
    }

    let secp = Secp256k1::new();
    let secret_key = SecretKey::from_slice(&private_key)
        .map_err(|e| CryptoError::SigningError(e.to_string()))?;

    let public_key = PublicKey::from_secret_key(&secp, &secret_key);

    Ok(Buffer::from(public_key.serialize().to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_keypair() {
        let keys = generate_keypair().unwrap();
        assert_eq!(keys.len(), 2);
        assert_eq!(keys[0].len(), 32); // Private key
        assert_eq!(keys[1].len(), 33); // Compressed public key
    }

    #[test]
    fn test_sign_verify() {
        let keys = generate_keypair().unwrap();
        let private_key = keys[0].clone();
        let public_key = keys[1].clone();

        let message = Buffer::from(b"Hello, World!".to_vec());
        let signature = sign_ecdsa(message.clone(), private_key).unwrap();

        let valid = verify_ecdsa(message, signature, public_key).unwrap();
        assert!(valid);
    }

    #[test]
    fn test_derive_public_key() {
        let keys = generate_keypair().unwrap();
        let private_key = keys[0].clone();
        let expected_public_key = keys[1].clone();

        let derived_public_key = derive_public_key(private_key).unwrap();

        assert_eq!(expected_public_key.as_ref(), derived_public_key.as_ref());
    }
}
