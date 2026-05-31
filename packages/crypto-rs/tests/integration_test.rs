//! Integration tests for TSS operations

use ritkey_crypto::{
    generate_threshold_keys_simple, threshold_sign_simple, verify_ecdsa,
    derive_public_key, CryptoError,
};

#[test]
fn test_full_threshold_workflow() {
    // Generate 2-of-3 keys
    let shares = generate_threshold_keys_simple(2, 3).unwrap();
    assert_eq!(shares.len(), 3);

    // Create message to sign
    let message = vec![0u8; 32];

    // Sign with shares 0 and 1
    let sig1 = threshold_sign_simple(
        vec![shares[0].clone(), shares[1].clone()],
        message.clone().into(),
    );
    assert!(sig1.is_ok());

    // Sign with shares 0 and 2 (different combination)
    let sig2 = threshold_sign_simple(
        vec![shares[0].clone(), shares[2].clone()],
        message.clone().into(),
    );
    assert!(sig2.is_ok());

    // Sign with shares 1 and 2
    let sig3 = threshold_sign_simple(
        vec![shares[1].clone(), shares[2].clone()],
        message.into(),
    );
    assert!(sig3.is_ok());
}

#[test]
fn test_threshold_insufficient_shares() {
    let shares = generate_threshold_keys_simple(2, 3).unwrap();
    let message = vec![0u8; 32];

    // Try with only 1 share (should fail)
    let result = threshold_sign_simple(vec![shares[0].clone()], message.into());

    assert!(result.is_err());
    match result.unwrap_err() {
        CryptoError::InsufficientShares { needed, got } => {
            assert_eq!(needed, 2);
            assert_eq!(got, 1);
        }
        _ => panic!("Expected InsufficientShares error"),
    }
}

#[test]
fn test_threshold_invalid_parameters() {
    // Threshold > total parties
    let result = generate_threshold_keys_simple(3, 2);
    assert!(result.is_err());

    // Zero threshold
    let result = generate_threshold_keys_simple(0, 3);
    assert!(result.is_err());

    // Zero parties
    let result = generate_threshold_keys_simple(2, 0);
    assert!(result.is_err());
}

#[test]
fn test_different_threshold_configurations() {
    // 2-of-3
    let shares_2_3 = generate_threshold_keys_simple(2, 3).unwrap();
    assert_eq!(shares_2_3.len(), 3);

    // 3-of-5
    let shares_3_5 = generate_threshold_keys_simple(3, 5).unwrap();
    assert_eq!(shares_3_5.len(), 5);

    // 2-of-2 (edge case)
    let shares_2_2 = generate_threshold_keys_simple(2, 2).unwrap();
    assert_eq!(shares_2_2.len(), 2);
}

#[test]
fn test_message_hash_validation() {
    let shares = generate_threshold_keys_simple(2, 3).unwrap();

    // Wrong message size (not 32 bytes)
    let wrong_size = vec![0u8; 16];
    let result = threshold_sign_simple(
        vec![shares[0].clone(), shares[1].clone()],
        wrong_size.into(),
    );

    assert!(result.is_err());
    match result.unwrap_err() {
        CryptoError::InvalidInput(msg) => {
            assert!(msg.contains("32 bytes"));
        }
        _ => panic!("Expected InvalidInput error"),
    }
}
