/**
 * P-256 request signing — ported from @ritkey/core/auth.ts so the MCP HTTP
 * service can sign wallet-service requests on behalf of each claimed visitor
 * without pulling in @ritkey/core (which has Rust dependencies).
 *
 * Pure Node crypto, no native modules.
 *
 * Payload format the wallet-service verifies:
 *   `${METHOD}|${PATH}|${TIMESTAMP_MS}|${SHA256(BODY)}`
 *
 * Request headers the wallet-service expects:
 *   X-API-Public-Key  (compressed P-256 public key, hex)
 *   X-Signature       (P-256 ECDSA signature over payload, hex)
 *   X-Timestamp       (unix ms; replay window is 5 min)
 */
import crypto from 'node:crypto';

export interface UserKeys {
  publicKey: string;   // compressed P-256 (66 hex chars)
  privateKey: string;  // JWK as JSON string
}

function bodyHash(body?: string): string {
  return body ? crypto.createHash('sha256').update(body).digest('hex') : '';
}

export function createRequestPayload(
  method: string,
  path: string,
  timestamp: number,
  body?: string
): string {
  return `${method}|${path}|${timestamp}|${bodyHash(body)}`;
}

export function signPayload(payload: string, privateKeyJwk: string): string {
  const key = crypto.createPrivateKey({
    key: JSON.parse(privateKeyJwk),
    format: 'jwk',
  });
  const signer = crypto.createSign('SHA256');
  signer.update(payload);
  signer.end();
  return signer.sign(key, 'hex');
}

/**
 * Wallet-service path extractor. The SDK calls `${baseUrl}${path}` where path
 * starts with `/wallets/...`. The signature payload uses just that path, not
 * the full URL — strip baseUrl off whatever fetch was handed.
 */
export function relativePath(fullUrl: string, baseUrl: string): string {
  if (fullUrl.startsWith(baseUrl)) {
    const rest = fullUrl.slice(baseUrl.length);
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  // Fallback — pull the URL's pathname
  try {
    return new URL(fullUrl).pathname;
  } catch {
    return fullUrl;
  }
}

/**
 * Build a fetch wrapper that signs every outbound request with the given
 * user's P-256 keys. Drop-in for the SDK's `fetch` config.
 *
 * The wrapper REMOVES any `Authorization: Bearer …` header the SDK or
 * caller added — we replace bearer auth with the signature triplet.
 */
export function signedFetch(baseUrl: string, keys: UserKeys): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = relativePath(url, baseUrl);
    const body =
      init?.body == null
        ? undefined
        : typeof init.body === 'string'
        ? init.body
        : Buffer.from(init.body as ArrayBuffer).toString('utf8');

    const timestamp = Date.now();
    const payload = createRequestPayload(method, path, timestamp, body);
    const signature = signPayload(payload, keys.privateKey);

    const headers = new Headers(init?.headers);
    headers.delete('authorization');
    headers.set('X-API-Public-Key', keys.publicKey);
    headers.set('X-Signature', signature);
    headers.set('X-Timestamp', String(timestamp));

    return fetch(url, { ...init, method, headers });
  };
}
