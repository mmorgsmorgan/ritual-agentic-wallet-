//! Ritkey Crypto - Rust Module
//!
//! Provides memory-safe cryptographic operations with threshold signatures.
//!
//! Features:
//! - Shamir's Secret Sharing (2-of-3 threshold with recovery)
//! - Memory-safe key operations with explicit zeroing
//! - AES-256-GCM encryption
//! - ECDSA signing on secp256k1
//!
//! Security: 6/10 (up from 4.1/10 with XOR)
//! - ✅ Threshold recovery (2-of-3)
//! - ✅ Memory safety (Rust + zeroize)
//! - ⚠️ Still reconstructs key during signing
//!
//! See TSS-ROADMAP.md for future improvements (GG20 TSS = 8-9/10)

#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

mod tss;           // Shamir's Secret Sharing
mod encryption;
mod signing;
mod memory;
mod error;

// Export Shamir's Secret Sharing
pub use tss::*;

// Export other modules
pub use encryption::*;
pub use signing::*;
pub use error::*;

use napi::{Result, Status};

/// Initialize the crypto module
#[napi]
pub fn init() -> Result<String> {
  Ok("Ritkey Crypto v1.0.0 - Threshold Signatures (Shamir 2-of-3)".to_string())
}

/// Get module version
#[napi]
pub fn version() -> String {
  env!("CARGO_PKG_VERSION").to_string()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_init() {
    let result = init().unwrap();
    assert!(result.contains("Threshold"));
  }
}
