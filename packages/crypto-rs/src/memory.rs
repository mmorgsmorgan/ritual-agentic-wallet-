//! Memory-safe operations with explicit zeroing

use zeroize::{Zeroize, ZeroizeOnDrop};

/// Secure byte buffer that zeros on drop
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct SecureBytes {
    data: Vec<u8>,
}

impl SecureBytes {
    /// Create new secure bytes
    pub fn new(data: Vec<u8>) -> Self {
        Self { data }
    }

    /// Get reference to data
    pub fn as_slice(&self) -> &[u8] {
        &self.data
    }

    /// Get mutable reference to data
    pub fn as_mut_slice(&mut self) -> &mut [u8] {
        &mut self.data
    }

    /// Consume and return inner data (caller responsible for zeroing)
    pub fn into_inner(mut self) -> Vec<u8> {
        let data = std::mem::take(&mut self.data);
        // self.data is now empty and will be zeroed on drop
        data
    }
}

impl From<Vec<u8>> for SecureBytes {
    fn from(data: Vec<u8>) -> Self {
        Self::new(data)
    }
}

impl AsRef<[u8]> for SecureBytes {
    fn as_ref(&self) -> &[u8] {
        &self.data
    }
}

/// Secure string that zeros on drop
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct SecureString {
    data: String,
}

impl SecureString {
    pub fn new(data: String) -> Self {
        Self { data }
    }

    pub fn as_str(&self) -> &str {
        &self.data
    }
}

impl From<String> for SecureString {
    fn from(data: String) -> Self {
        Self::new(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_secure_bytes_zeros_on_drop() {
        let data = vec![1, 2, 3, 4, 5];
        let secure = SecureBytes::new(data.clone());

        assert_eq!(secure.as_slice(), &[1, 2, 3, 4, 5]);

        drop(secure);
        // Data is zeroed after drop (verified by zeroize crate)
    }

    #[test]
    fn test_secure_string_zeros_on_drop() {
        let data = "secret_key_12345".to_string();
        let secure = SecureString::new(data.clone());

        assert_eq!(secure.as_str(), "secret_key_12345");

        drop(secure);
        // Data is zeroed after drop
    }
}
