/**
 * Provisions a fresh wallet-service user on demand. Called by /claim when a
 * new visitor arrives.
 *
 * Uses the admin user's P-256 keys (env: ADMIN_PUBLIC_KEY / ADMIN_PRIVATE_KEY)
 * to authenticate against POST /users/ on the wallet service. The new user
 * gets a single API keypair with permissions sufficient to manage one wallet
 * + its events.
 */
import { signedFetch, type UserKeys } from './auth-p256.js';

export interface ProvisionedUser {
  userId: string;
  publicKey: string;
  privateKey: string;
}

const PERMISSIONS = [
  'wallet:create',
  'wallet:read',
  'wallet:send',
  'wallet:sign',
  'wallet:fund',
  'wallet:export',
  'webhook:create',
  'webhook:read',
  'webhook:update',
  'webhook:delete',
  'alert:create',
  'alert:read',
  'alert:update',
  'alert:delete',
  'event:read',
];

export async function provisionUser(
  walletServiceUrl: string,
  adminKeys: UserKeys,
  label: string
): Promise<ProvisionedUser> {
  const fetcher = signedFetch(walletServiceUrl, adminKeys);
  const url = `${walletServiceUrl.replace(/\/+$/, '')}/users`;

  const body = JSON.stringify({
    userName: label,
    userType: 'agent',
    apiKeys: [{ keyName: 'primary' }],
    permissions: PERMISSIONS,
  });

  const res = await fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`provision_user_failed ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    user: { id: string };
    apiKeys: { publicKey: string; privateKey: string }[];
  };

  return {
    userId: data.user.id,
    publicKey: data.apiKeys[0].publicKey,
    privateKey: data.apiKeys[0].privateKey,
  };
}
