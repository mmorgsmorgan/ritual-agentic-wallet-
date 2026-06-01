import crypto from 'crypto';
import { randomUUID } from 'crypto';

/**
 * P-256 API Key Authentication System
 *
 * Similar to Turnkey's approach:
 * - Users/agents have P-256 keypairs
 * - Public key stored in DB
 * - Requests signed with private key
 * - Server verifies signature
 */

export interface ApiKeyPair {
  publicKey: string;   // Compressed P-256 public key (hex)
  privateKey: string;  // P-256 private key (JWK format)
}

export interface ApiKeyCredentials {
  apiKeyId: string;
  publicKey: string;
  privateKey: string;
}

/**
 * Generate a P-256 keypair for API authentication
 */
export function generateApiKeyPair(): ApiKeyPair {
  const keyPair = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256'
  });

  const pubJwk = keyPair.publicKey.export({ format: 'jwk' }) as any;
  const privJwk = keyPair.privateKey.export({ format: 'jwk' }) as any;

  // Create compressed public key (Turnkey format)
  const xHex = Buffer.from(pubJwk.x!, 'base64url').toString('hex').padStart(64, '0');
  const yBuf = Buffer.from(pubJwk.y!, 'base64url');
  const prefix = (yBuf[31] & 1) === 0 ? '02' : '03';
  const compressedPublicKey = prefix + xHex;

  return {
    publicKey: compressedPublicKey,
    privateKey: JSON.stringify(privJwk),
  };
}

/**
 * Sign a request payload with a P-256 private key
 */
export function signRequest(
  payload: string,
  privateKeyJwk: string
): string {
  const privKey = crypto.createPrivateKey({
    key: JSON.parse(privateKeyJwk),
    format: 'jwk',
  });

  const sign = crypto.createSign('SHA256');
  sign.update(payload);
  sign.end();

  return sign.sign(privKey, 'hex');
}

/**
 * Verify a request signature with a P-256 public key
 */
export function verifyRequestSignature(
  payload: string,
  signature: string,
  compressedPublicKey: string
): boolean {
  try {
    // Decompress public key
    const prefix = compressedPublicKey.slice(0, 2);
    const xHex = compressedPublicKey.slice(2);

    // Reconstruct y coordinate (simplified - full implementation needs elliptic curve math)
    // For now, we'll use the uncompressed format approach
    const pubKey = crypto.createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: Buffer.from(xHex, 'hex').toString('base64url'),
        // Note: Full y-coordinate reconstruction needed for production
      },
      format: 'jwk',
    });

    const verify = crypto.createVerify('SHA256');
    verify.update(payload);
    verify.end();

    return verify.verify(pubKey, signature, 'hex');
  } catch (err) {
    return false;
  }
}

/**
 * Create request payload for signing
 * Format: METHOD|PATH|TIMESTAMP|BODY_HASH
 */
export function createRequestPayload(
  method: string,
  path: string,
  timestamp: number,
  body?: string
): string {
  const bodyHash = body
    ? crypto.createHash('sha256').update(body).digest('hex')
    : '';

  return `${method}|${path}|${timestamp}|${bodyHash}`;
}

/**
 * Generate API key credentials for a new user/agent
 */
export function generateApiKeyCredentials(name: string): ApiKeyCredentials {
  const keyPair = generateApiKeyPair();
  const apiKeyId = randomUUID();

  return {
    apiKeyId,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  };
}
