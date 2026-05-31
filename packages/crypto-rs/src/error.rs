//! Error types for Ritkey Crypto

use napi::{Error as NapiError, Status};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("TSS error: {0}")]
    TssError(String),

    #[error("Threshold error: {0}")]
    ThresholdError(String),

    #[error("Encryption error: {0}")]
    EncryptionError(String),

    #[error("Signing error: {0}")]
    SigningError(String),

    #[error("Invalid threshold: {0}")]
    InvalidThreshold(String),

    #[error("Insufficient shares: need {needed}, got {got}")]
    InsufficientShares { needed: usize, got: usize },

    #[error("Serialization error: {0}")]
    SerializationError(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),
}

impl From<CryptoError> for NapiError {
    fn from(err: CryptoError) -> Self {
        NapiError::new(Status::GenericFailure, err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, CryptoError>;
