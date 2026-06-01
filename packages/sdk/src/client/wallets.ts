/**
 * Wallet operations.
 *
 * Maps directly to the @ritkey/service HTTP API:
 *
 *   POST   /wallets                       create()
 *   POST   /wallets/import                import_()
 *   GET    /wallets                       list()
 *   GET    /wallets/me                    me()
 *   GET    /wallets/:id                   get(id)
 *   GET    /wallets/:id/balance           balance(id)
 *   POST   /wallets/:id/send              send(...)
 *   POST   /wallets/:id/sign              sign(...)
 *   POST   /wallets/:id/fund              fund(id)
 *   POST   /wallets/:id/export-key        exportKey(...)
 *   POST   /wallets/:id/sweep-and-archive sweepAndArchive(...)
 *   POST   /wallets/:id/freeze            freeze(id)
 *   POST   /wallets/:id/unfreeze          unfreeze(id)
 */

import type { HttpTransport } from '../transport.js';
import type {
  CreatedWallet,
  Wallet,
  BalanceResponse,
  SendTransactionInput,
  SignMessageInput,
  ExportKeyInput,
  SweepInput,
  SentTransaction,
  ExportedKey,
} from '../types.js';

export class WalletsClient {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Create a new threshold (Shamir 2-of-3) wallet.
   *
   * The response includes the agentShard and backupShard ONCE. The SDK
   * passes them through verbatim — your application is responsible for
   * storing them safely.
   */
  async create(input?: { label?: string }): Promise<CreatedWallet> {
    return this.http.request<CreatedWallet>('POST', '/wallets', input ?? {});
  }

  /**
   * Import an existing private key (e.g. from MetaMask / Rabby) into Ritkey.
   *
   * The key is split into 2-of-3 Shamir shares. Server keeps share 1, you
   * receive shares 2 and 3.
   */
  async import_(input: { privateKey: string; label?: string }): Promise<CreatedWallet> {
    return this.http.request<CreatedWallet>('POST', '/wallets/import', input);
  }

  async list(): Promise<{ wallets: Wallet[]; count: number }> {
    return this.http.request<{ wallets: Wallet[]; count: number }>('GET', '/wallets');
  }

  /** GET /wallets/me — returns the wallet bound to the current API key. */
  async me(): Promise<Wallet> {
    return this.http.request<Wallet>('GET', '/wallets/me');
  }

  async get(walletId: string): Promise<Wallet> {
    return this.http.request<Wallet>('GET', `/wallets/${encodeURIComponent(walletId)}`);
  }

  async balance(walletId: string): Promise<BalanceResponse> {
    return this.http.request<BalanceResponse>(
      'GET',
      `/wallets/${encodeURIComponent(walletId)}/balance`
    );
  }

  /**
   * Sign and broadcast a transaction.
   *
   * The agentShard is sent over the wire to the server, which combines it
   * with its server shard to reconstruct the private key (in Rust, briefly,
   * zeroized after signing). See SECURITY-MODEL.md for the exact trust model.
   */
  async send(input: SendTransactionInput): Promise<SentTransaction> {
    const { walletId, ...body } = input;
    return this.http.request<SentTransaction>(
      'POST',
      `/wallets/${encodeURIComponent(walletId)}/send`,
      body
    );
  }

  async sign(input: SignMessageInput): Promise<{ signature: string; address: string }> {
    const { walletId, ...body } = input;
    return this.http.request<{ signature: string; address: string }>(
      'POST',
      `/wallets/${encodeURIComponent(walletId)}/sign`,
      body
    );
  }

  async fund(walletId: string): Promise<{
    hash: string;
    from: string;
    to: string;
    amount: string;
    explorer: string;
  }> {
    return this.http.request('POST', `/wallets/${encodeURIComponent(walletId)}/fund`);
  }

  /**
   * Export the private key. ⚠️ After a successful export the wallet is
   * archived and can no longer be used through Ritkey. Save the privateKey
   * (and consider sweeping funds to a fresh wallet).
   */
  async exportKey(input: ExportKeyInput): Promise<ExportedKey> {
    const { walletId, ...rest } = input;
    return this.http.request<ExportedKey>(
      'POST',
      `/wallets/${encodeURIComponent(walletId)}/export-key`,
      { ...rest, confirm: true }
    );
  }

  async sweepAndArchive(input: SweepInput): Promise<{
    status: 'archived';
    walletId: string;
    swept: boolean;
    sweepTxHash: string | null;
    sweepTo: string;
    apiKeyGrantReleased: boolean;
  }> {
    const { walletId, ...body } = input;
    return this.http.request(
      'POST',
      `/wallets/${encodeURIComponent(walletId)}/sweep-and-archive`,
      body
    );
  }

  async freeze(walletId: string): Promise<{ status: 'frozen'; walletId: string }> {
    return this.http.request(
      'POST',
      `/wallets/${encodeURIComponent(walletId)}/freeze`
    );
  }

  async unfreeze(walletId: string): Promise<{ status: 'active'; walletId: string }> {
    return this.http.request(
      'POST',
      `/wallets/${encodeURIComponent(walletId)}/unfreeze`
    );
  }
}
