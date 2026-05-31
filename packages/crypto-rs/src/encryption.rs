//! AES-256-GCM encryption with memory safety

use crate::error::CryptoError;
use crate::memory::SecureBytes;
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use napi::bindgen_prelude::*;
use zeroize::Zeroize;

const NONCE_SIZE: usize = 12;
const KEY_SIZE: usize = 32;

/// Encrypt data with AES-256-GCM
///
/// # Arguments
/// * `plaintext` - Data to encrypt
/// * `key` - 32-byte encryption key
///
/// # Returns
/// Encrypted data (nonce + ciphertext + tag)
#[napi]
pub fn encrypt_aes_gcm(plaintext: Buffer, key: Buffer) -> napi::Result<Buffer> {
    if key.len() != KEY_SIZE {
        return Err(CryptoError::EncryptionError(
            format!("Key must be {} bytes", KEY_SIZE),
        ).into());
    }

    // Create cipher
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| CryptoError::EncryptionError(e.to_string()))?;

    // Generate random nonce
    let nonce_bytes: [u8; NONCE_SIZE] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| CryptoError::EncryptionError(e.to_string()))?;

    // Combine nonce + ciphertext
    let mut result = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);

    Ok(Buffer::from(result))
}

/// Decrypt data with AES-256-GCM
///
/// # Arguments
/// * `ciphertext` - Encrypted data (nonce + ciphertext + tag)
/// * `key` - 32-byte encryption key
///
/// # Returns
/// Decrypted plaintext
#[napi]
pub fn decrypt_aes_gcm(ciphertext: Buffer, key: Buffer) -> napi::Result<Buffer> {
    if key.len() != KEY_SIZE {
        return Err(CryptoError::EncryptionError(
            format!("Key must be {} bytes", KEY_SIZE),
        ).into());
    }

    if ciphertext.len() < NONCE_SIZE {
        return Err(CryptoError::EncryptionError(
            "Ciphertext too short".to_string(),
        ).into());
    }

    // Split nonce and ciphertext
    let (nonce_bytes, encrypted_data) = ciphertext.split_at(NONCE_SIZE);
    let nonce = Nonce::from_slice(nonce_bytes);

    // Create cipher
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| CryptoError::EncryptionError(e.to_string()))?;

    // Decrypt
    let plaintext = cipher
        .decrypt(nonce, encrypted_data)
        .map_err(|_e| CryptoError::EncryptionError("Decryption failed".to_string()))?;

    Ok(Buffer::from(plaintext))
}

/// Generate random encryption key (32 bytes)
#[napi]
pub fn generate_encryption_key() -> Buffer {
    let key: [u8; KEY_SIZE] = rand::random();
    Buffer::from(key.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt() {
        let key = generate_encryption_key();
        let plaintext = Buffer::from(b"Hello, World!".to_vec());

        let ciphertext = encrypt_aes_gcm(plaintext.clone(), key.clone()).unwrap();
        let decrypted = decrypt_aes_gcm(ciphertext, key).unwrap();

        assert_eq!(plaintext.as_ref(), decrypted.as_ref());
    }

    #[test]
    fn test_invalid_key_size() {
        let plaintext = Buffer::from(b"test".to_vec());
        let bad_key = Buffer::from(vec![0u8; 16]); // Wrong size

        let result = encrypt_aes_gcm(plaintext, bad_key);
        assert!(result.is_err());
    }

    #[test]
    fn test_tampered_ciphertext() {
        let key = generate_encryption_key();
        let plaintext = Buffer::from(b"secret".to_vec());

        let mut ciphertext = encrypt_aes_gcm(plaintext, key.clone()).unwrap();

        // Tamper with ciphertext
        ciphertext[20] ^= 0xFF;

        let result = decrypt_aes_gcm(ciphertext, key);
        assert!(result.is_err());
    }
}
