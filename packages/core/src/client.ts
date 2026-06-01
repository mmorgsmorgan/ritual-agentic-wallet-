import { signRequest, createRequestPayload } from './auth.js';

/**
 * Ritkey Client SDK
 *
 * Turnkey-style client for agents and humans to interact with Ritkey service.
 * Handles P-256 signature authentication automatically.
 */

export interface RitkeyClientConfig {
  apiBaseUrl: string;
  apiPublicKey: string;
  apiPrivateKey: string; // JWK format
}

export class RitkeyClient {
  private config: RitkeyClientConfig;

  constructor(config: RitkeyClientConfig) {
    this.config = config;
  }

  /**
   * Make an authenticated request to Ritkey service
   */
  private async request<T>(
    method: string,
    path: string,
    body?: any
  ): Promise<T> {
    const timestamp = Date.now();
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const payload = createRequestPayload(method, path, timestamp, bodyStr);
    const signature = signRequest(payload, this.config.apiPrivateKey);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Public-Key': this.config.apiPublicKey,
      'X-Signature': signature,
      'X-Timestamp': timestamp.toString(),
    };

    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      method,
      headers,
      body: bodyStr,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(`Ritkey API error: ${(error as any).error || response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  // ============================================================
  // Wallet Operations
  // ============================================================

  /**
   * Create a new wallet
   */
  async createWallet(params: { label?: string } = {}): Promise<{
    walletId: string;
    address: string;
    agentShard: string;
    next: { steps: string[] };
  }> {
    return this.request('POST', '/wallets', params);
  }

  /**
   * Get wallet info
   */
  async getWallet(walletId: string): Promise<{
    id: string;
    address: string;
    label: string;
    status: string;
    createdAt: string;
  }> {
    return this.request('GET', `/wallets/${walletId}`);
  }

  /**
   * Get wallet balance
   */
  async getBalance(walletId: string): Promise<{
    native: { wei: string; formatted: string };
    ritualWallet: { wei: string; formatted: string };
  }> {
    return this.request('GET', `/wallets/${walletId}/balance`);
  }

  /**
   * Send transaction
   */
  async sendTransaction(
    walletId: string,
    params: {
      agentShard: string;
      to: string;
      value?: string;
      data?: string;
    }
  ): Promise<{
    hash: string;
    from: string;
    to: string;
    value: string;
    explorer: string;
  }> {
    return this.request('POST', `/wallets/${walletId}/send`, params);
  }

  /**
   * Sign a message
   */
  async signMessage(
    walletId: string,
    params: {
      agentShard: string;
      message: string;
    }
  ): Promise<{
    signature: string;
    address: string;
    message: string;
  }> {
    return this.request('POST', `/wallets/${walletId}/sign`, params);
  }

  /**
   * Claim faucet funding
   */
  async fundWallet(walletId: string): Promise<{
    hash: string;
    from: string;
    to: string;
    amount: string;
    explorer: string;
  }> {
    return this.request('POST', `/wallets/${walletId}/fund`);
  }

  /**
   * Deposit to RitualWallet escrow
   */
  async depositToRitualWallet(
    walletId: string,
    params: {
      agentShard: string;
      amount: string;
    }
  ): Promise<{
    hash: string;
    amount: string;
    explorer: string;
  }> {
    return this.request('POST', `/wallets/${walletId}/deposit-ritual`, params);
  }

  /**
   * Get transaction history
   */
  async getTransactions(walletId: string): Promise<{
    transactions: Array<{
      id: string;
      hash: string;
      toAddress: string;
      value: string;
      status: string;
      createdAt: string;
    }>;
  }> {
    return this.request('GET', `/wallets/${walletId}/transactions`);
  }

  /**
   * List all wallets
   */
  async listWallets(): Promise<{
    wallets: Array<{
      id: string;
      address: string;
      label: string;
      status: string;
      createdAt: string;
    }>;
  }> {
    return this.request('GET', '/wallets');
  }

  // ============================================================
  // User Operations (Admin only)
  // ============================================================

  /**
   * Get current user info
   */
  async getMe(): Promise<{
    user: {
      id: string;
      userName: string;
      userType: 'human' | 'agent';
      status: string;
    };
    permissions: string[];
  }> {
    return this.request('GET', '/users/me');
  }

  /**
   * List all users (admin only)
   */
  async listUsers(): Promise<{
    users: Array<{
      id: string;
      userName: string;
      userType: 'human' | 'agent';
      status: string;
      createdAt: string;
    }>;
  }> {
    return this.request('GET', '/users');
  }

  /**
   * Create a new user (admin only)
   */
  async createUser(params: {
    userName: string;
    userType: 'human' | 'agent';
    apiKeys: Array<{ keyName: string }>;
    permissions: string[];
  }): Promise<{
    user: {
      id: string;
      userName: string;
      userType: 'human' | 'agent';
      status: string;
      createdAt: string;
    };
    apiKeys: Array<{
      keyName: string;
      publicKey: string;
      privateKey: string;
    }>;
    permissions: string[];
    warning: string;
  }> {
    return this.request('POST', '/users', params);
  }
}

/**
 * Create a Ritkey client for an agent
 */
export function createAgentClient(
  apiBaseUrl: string,
  publicKey: string,
  privateKey: string
): RitkeyClient {
  return new RitkeyClient({
    apiBaseUrl,
    apiPublicKey: publicKey,
    apiPrivateKey: privateKey,
  });
}
