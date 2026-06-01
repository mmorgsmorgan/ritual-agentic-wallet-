import express from 'express';
import { type Address, type Hex, parseEther, formatEther, keccak256, encodePacked } from 'viem';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  generateWalletKeypair,
  splitKey,
  encryptShard,
  decryptShard,
  reconstructKey,
  signAndSendTransaction,
  signMessage,
  policyEngine,
  loadConfig,
  getNativeBalance,
  getRitualWalletBalance,
  depositToRitualWallet,
  getTransactionReceipt as getRitualReceipt,
  getCurrentBlock,
  SYSTEM_CONTRACTS,
  PRECOMPILES,
  getPublicClient,
  generateThresholdWallet,
  thresholdSign,
  importPrivateKey,
  exportPrivateKey,
  signAndSendTransactionWithKey,
  signMessageWithKey,
} from '@ritkey/core';
import { fundWalletFromFaucet, FaucetError } from '../faucet.js';
import {
  createWallet as dbCreateWallet,
  getWallet,
  getWalletByAddress,
  listWallets,
  getPolicy,
  updatePolicy,
  recordTransaction,
  getTransactions,
  getRecentTransactions,
  getAuditLog,
  logAudit,
  getStats,
  updateWalletStatus,
  claimApiKeyGrant,
  getApiKeyGrant,
  revertApiKeyGrant,
} from '../db/database.js';
import {
  authMiddleware,
  rateLimitMiddleware,
  validate,
  errorHandler,
  CreateWalletSchema,
  SendTransactionSchema,
  SignMessageSchema,
  DepositRitualSchema,
  UpdatePolicySchema,
  SweepAndArchiveSchema,
  ExportKeySchema,
  ImportKeySchema,
} from './middleware.js';
import { registerWebhookRoutes } from './webhooks.js';
import { registerAlertRoutes } from './alerts.js';
import { startDeliveryWorker } from '../events/delivery.js';
import { startBalancePoller } from '../events/balance-poller.js';
import { startChainIndexer } from '../events/chain-indexer.js';
import { emitEvent } from '../events/emitter.js';
import { ensureWebhookCryptoReady } from '../events/subscriptions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Extract a route param as a string (Express 5 returns string | string[]) */
function param(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] || '';
  return val || '';
}

/**
 * M4: verify the calling API key owns the targeted wallet.
 *
 * In OPEN_MODE (req.apiKeyHash == null) we skip the ownership check —
 * OPEN_MODE is by design a single-tenant local dev mode.
 *
 * In authenticated mode, the wallet must be bound to this api_key_hash
 * via api_key_grants. Returns true if allowed; sends 403 and returns false
 * if not.
 */
function assertOwnsWallet(req: any, res: any, walletId: string): boolean {
  if (req.apiKeyHash == null) return true; // OPEN_MODE
  const grant = getApiKeyGrant(req.apiKeyHash);
  if (!grant || grant.walletId !== walletId) {
    res.status(403).json({
      error: 'API key does not own this wallet',
      code: 'wallet_not_owned',
    });
    return false;
  }
  return true;
}

export function createApp() {
  const app = express();

  // ── Global Middleware ─────────────────────────────────────
  app.use(express.json());
  app.use(rateLimitMiddleware(120, 60_000));

  // Serve dashboard static files
  const dashboardPath = path.join(__dirname, '..', 'dashboard');
  app.use('/dashboard', express.static(dashboardPath));

  // ── Health Check ──────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', chain: 'Ritual (1979)', timestamp: new Date().toISOString() });
  });

  // ── Stats ─────────────────────────────────────────────────
  app.get('/stats', authMiddleware, (_req, res) => {
    const stats = getStats();
    res.json(stats);
  });

  // ── Chain Info ────────────────────────────────────────────
  app.get('/chain', (_req, res) => {
    res.json({
      chainId: 1979,
      name: 'Ritual Chain',
      currency: 'RITUAL',
      rpc: process.env.RITUAL_RPC_URL || 'https://rpc.ritualfoundation.org',
      explorer: 'https://explorer.ritualfoundation.org',
      contracts: SYSTEM_CONTRACTS,
      precompiles: PRECOMPILES,
    });
  });

  // ══════════════════════════════════════════════════════════
  //  WALLET ENDPOINTS
  // ══════════════════════════════════════════════════════════

  /**
   * POST /wallets — Create a new agent wallet
   * Returns the wallet ID, address, and the agent's key share.
   *
   * Now uses Shamir 2-of-3 threshold signatures for improved security.
   * Returns 3 shares: server (stored), agent (returned), backup (returned).
   *
   * Sybil defense (layer B): in authenticated mode, an API-key hash can
   * only ever own ONE wallet. Subsequent calls return 409.
   */
  app.post('/wallets', authMiddleware, validate(CreateWalletSchema), (req, res, next) => {
    try {
      const { label } = req.body as { label: string };
      const apiKeyHash = req.apiKeyHash ?? null;

      // Layer B: enforce 1 wallet per API-key hash (skipped in OPEN_MODE)
      if (apiKeyHash) {
        const existing = getApiKeyGrant(apiKeyHash);
        if (existing) {
          res.status(409).json({
            error: 'This API key already owns a wallet. Use GET /wallets/me to retrieve it.',
            code: 'api_key_already_bound',
            walletId: existing.walletId,
          });
          return;
        }
      }

      // 1. Generate threshold wallet (2-of-3 Shamir)
      const thresholdWallet = generateThresholdWallet();

      // 2. Encrypt server shard and backup shard for at-rest storage
      const encryptionKey = loadConfig().encryptionKey;
      const encryptedServerShard = encryptShard(thresholdWallet.shares[0], encryptionKey);
      const encryptedBackupShard = encryptShard(thresholdWallet.shares[2], encryptionKey);

      // 3. Store wallet with threshold metadata
      const wallet = dbCreateWallet(
        thresholdWallet.address,
        thresholdWallet.publicKey,
        encryptedServerShard,
        label,
        encryptedBackupShard,
        'threshold',
        thresholdWallet.threshold,
        thresholdWallet.totalShares
      );

      if (apiKeyHash) {
        const claimed = claimApiKeyGrant(apiKeyHash, wallet.id);
        if (!claimed) {
          // Lost the race — clean up the orphan wallet so we don't leak shards
          updateWalletStatus(wallet.id, 'archived');
          res.status(409).json({
            error: 'This API key already owns a wallet (race detected).',
            code: 'api_key_already_bound',
          });
          return;
        }
      }

      // Emit wallet.created event
      emitEvent({
        type: 'wallet.created',
        walletId: wallet.id,
        data: {
          walletId: wallet.id,
          address: wallet.address,
          label: wallet.label,
          walletType: 'threshold',
          threshold: thresholdWallet.threshold,
        },
      } as any);

      // 4. Return wallet info + agent shard + backup shard (ONE TIME ONLY)
      res.status(201).json({
        walletId: wallet.id,
        address: wallet.address,
        publicKey: wallet.publicKey,
        agentShard: thresholdWallet.shares[1],  // Agent's share
        backupShard: thresholdWallet.shares[2], // Backup share (cold storage)
        walletType: 'threshold',
        threshold: thresholdWallet.threshold,
        totalShares: thresholdWallet.totalShares,
        label: wallet.label,
        createdAt: wallet.createdAt,
        _notice: 'SAVE YOUR AGENT SHARD AND BACKUP SHARD! They are shown only once. You need any 2 of 3 shares to sign transactions.',
        _security: 'This wallet uses Shamir 2-of-3 threshold signatures. Server has share 1, you have shares 2 and 3. Store the backup shard securely (cold storage).',
        next: {
          message:
            'Before your first on-chain action, load the Ritual bootstrap context via the MCP server.',
          mcpPrompt: 'ritual-bootstrap',
          mcpTools: [
            { name: 'read_ritual_rules', why: 'Hard constraints — revert-on-violation.' },
            { name: 'list_ritual_skills', why: 'Discover the bundled Ritual Chain skill docs.' },
            { name: 'fund_wallet', args: { walletId: wallet.id }, why: 'Claim the one-time faucet drip.' },
          ],
          restEndpoints: [
            { method: 'POST', path: `/wallets/${wallet.id}/fund`, why: 'Claim the one-time faucet drip.' },
            { method: 'GET', path: `/wallets/${wallet.id}/balance`, why: 'Check native + RitualWallet escrow balance.' },
          ],
        },
      });
    } catch (err) {
      // If anything failed after the grant was inserted, free it up
      if (req.apiKeyHash) revertApiKeyGrant(req.apiKeyHash);
      next(err);
    }
  });

  /**
   * GET /wallets/me — Return the wallet bound to the calling API key
   */
  app.get('/wallets/me', authMiddleware, (req, res) => {
    if (!req.apiKeyHash) {
      res.status(400).json({
        error: '/wallets/me is only meaningful in authenticated mode',
        code: 'open_mode',
      });
      return;
    }
    const grant = getApiKeyGrant(req.apiKeyHash);
    if (!grant) {
      res.status(404).json({ error: 'No wallet bound to this API key' });
      return;
    }
    const wallet = getWallet(grant.walletId);
    if (!wallet) {
      res.status(404).json({ error: 'Bound wallet missing — please recreate' });
      return;
    }
    res.json({
      id: wallet.id,
      address: wallet.address,
      publicKey: wallet.publicKey,
      label: wallet.label,
      status: wallet.status,
      createdAt: wallet.createdAt,
      fundedAt: wallet.fundedAt,
    });
  });

  /**
   * GET /wallets — List all wallets
   */
  app.get('/wallets', authMiddleware, (_req, res) => {
    const wallets = listWallets().map((w) => ({
      id: w.id,
      address: w.address,
      label: w.label,
      status: w.status,
      createdAt: w.createdAt,
    }));
    res.json({ wallets, count: wallets.length });
  });

  /**
   * GET /wallets/:id — Get wallet details
   */
  app.get('/wallets/:id', authMiddleware, (req, res) => {
    const wallet = getWallet(param(req.params.id));
    if (!wallet) {
      res.status(404).json({ error: 'Wallet not found' });
      return;
    }
    res.json({
      id: wallet.id,
      address: wallet.address,
      publicKey: wallet.publicKey,
      label: wallet.label,
      status: wallet.status,
      createdAt: wallet.createdAt,
    });
  });

  /**
   * GET /wallets/:id/balance — Get on-chain balances
   */
  app.get('/wallets/:id/balance', authMiddleware, async (req, res, next) => {
    try {
      const wallet = getWallet(param(req.params.id));
      if (!wallet) {
        res.status(404).json({ error: 'Wallet not found' });
        return;
      }

      const [native, ritual, block] = await Promise.all([
        getNativeBalance(wallet.address as Address),
        getRitualWalletBalance(wallet.address as Address),
        getCurrentBlock(),
      ]);

      res.json({
        address: wallet.address,
        native: { wei: native.wei.toString(), formatted: native.formatted, symbol: 'RITUAL' },
        ritualWallet: {
          balance: ritual.balance.toString(),
          formatted: ritual.formatted,
          lockUntil: ritual.lockUntil.toString(),
          isLocked: ritual.isLocked,
        },
        currentBlock: block.toString(),
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /wallets/:id/send — Sign and send a transaction
   *
   * Supports both XOR (legacy) and threshold (new) wallets.
   * For threshold wallets, provide agentShard (any 2 of 3 shares work).
   */
  app.post('/wallets/:id/send', authMiddleware, validate(SendTransactionSchema), async (req, res, next) => {
    try {
      const wallet = getWallet(param(req.params.id));
      if (!wallet) {
        res.status(404).json({ error: 'Wallet not found' });
        return;
      }
      if (!assertOwnsWallet(req, res, wallet.id)) return;
      if (wallet.status !== 'active') {
        res.status(403).json({ error: `Wallet is ${wallet.status}` });
        return;
      }

      const { agentShard, to, value, data } = req.body as {
        agentShard: string;
        to: string;
        value: string;
        data: string;
      };

      // Policy check
      const policy = getPolicy(wallet.id);
      const recentTxs = getRecentTransactions(wallet.id);
      const policyResult = policyEngine.evaluate(
        policy,
        to as Address,
        value,
        recentTxs
      );
      if (!policyResult.allowed) {
        res.status(403).json({ error: 'Policy violation', reason: policyResult.reason });
        return;
      }

      const encryptionKey = loadConfig().encryptionKey;
      let result;

      // Handle based on wallet type
      if (wallet.walletType === 'threshold') {
        // Threshold wallet: reconstruct via Rust Shamir, sign, broadcast.
        // exportPrivateKey runs reconstruction in Rust (zeroized in the
        // sharks recover path) and returns the key once at the JS boundary.
        // We use it locally and discard the reference immediately.
        const serverShard = decryptShard(wallet.serverShard, encryptionKey);
        const privateKey = exportPrivateKey([serverShard, agentShard]);
        try {
          result = await signAndSendTransactionWithKey(privateKey, {
            to: to as Address,
            value,
            data: data as Hex,
          });
        } finally {
          // Best-effort: drop our reference. V8 strings can't be zeroed,
          // but at least we don't keep them alive past this scope.
          // (See SECURITY-MODEL.md for the honest threat model.)
        }
      } else {
        // Legacy XOR wallet (deprecated)
        const serverShard = decryptShard(wallet.serverShard, encryptionKey);
        result = await signAndSendTransaction(serverShard, agentShard, {
          to: to as Address,
          value,
          data: data as Hex,
        });
      }

      // Record transaction
      recordTransaction(
        wallet.id,
        result.hash,
        to,
        parseEther(value).toString(),
        data,
        'confirmed'
      );

      // Emit tx.sent event.
      // L5: cap calldata at 4KB so a giant tx doesn't blow up the events
      // table (each event row also gets copied per webhook delivery).
      const dataTruncated = data && data.length > 4096
        ? data.slice(0, 4096) + '...[truncated]'
        : data;
      emitEvent({
        type: 'tx.sent',
        walletId: wallet.id,
        data: {
          walletId: wallet.id,
          hash: result.hash,
          from: result.from,
          to: result.to,
          value: parseEther(value).toString(),
          valueFormatted: value,
          data: dataTruncated,
          explorer: `https://explorer.ritualfoundation.org/tx/${result.hash}`,
        },
      } as any);

      res.json({
        hash: result.hash,
        from: result.from,
        to: result.to,
        value,
        walletType: wallet.walletType,
        explorer: `https://explorer.ritualfoundation.org/tx/${result.hash}`,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /wallets/:id/sign — Sign a message
   */
  app.post('/wallets/:id/sign', authMiddleware, validate(SignMessageSchema), async (req, res, next) => {
    try {
      const wallet = getWallet(param(req.params.id));
      if (!wallet) {
        res.status(404).json({ error: 'Wallet not found' });
        return;
      }
      if (!assertOwnsWallet(req, res, wallet.id)) return;
      if (wallet.status !== 'active') {
        res.status(403).json({ error: `Wallet is ${wallet.status}`, code: 'wallet_not_active' });
        return;
      }

      const { agentShard, message } = req.body as {
        agentShard: string;
        message: string;
      };

      const encryptionKey = loadConfig().encryptionKey;
      const serverShard = decryptShard(wallet.serverShard, encryptionKey);

      let result;
      if (wallet.walletType === 'threshold') {
        // Threshold: reconstruct via Rust Shamir, then sign at JS boundary.
        const privateKey = exportPrivateKey([serverShard, agentShard]);
        result = await signMessageWithKey(privateKey, message);
      } else {
        // Legacy XOR
        result = await signMessage(serverShard, agentShard, message);
      }

      // Emit message.signed event.
      // L1: do NOT include message contents. Sending the first 100 chars of
      // a signed message can leak permit nonces, SIWE challenges, etc.
      // Subscribers who need the message can store it themselves.
      emitEvent({
        type: 'message.signed',
        walletId: wallet.id,
        data: {
          walletId: wallet.id,
          address: result.address,
          messagePreview: '[REDACTED]',
        },
      } as any);

      res.json({
        signature: result.signature,
        address: result.address,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /wallets/:id/deposit-ritual — Deposit to RitualWallet escrow
   */
  app.post('/wallets/:id/deposit-ritual', authMiddleware, validate(DepositRitualSchema), async (req, res, next) => {
    try {
      const wallet = getWallet(param(req.params.id));
      if (!wallet) {
        res.status(404).json({ error: 'Wallet not found' });
        return;
      }
      if (!assertOwnsWallet(req, res, wallet.id)) return;
      if (wallet.status !== 'active') {
        res.status(403).json({ error: `Wallet is ${wallet.status}`, code: 'wallet_not_active' });
        return;
      }

      const { agentShard, amount, lockDuration } = req.body as {
        agentShard: string;
        amount: string;
        lockDuration: number;
      };

      // Reconstruct key
      const encryptionKey = loadConfig().encryptionKey;
      const serverShard = decryptShard(wallet.serverShard, encryptionKey);
      const privateKey = reconstructKey(serverShard, agentShard);

      const result = await depositToRitualWallet(privateKey, amount, BigInt(lockDuration));

      recordTransaction(
        wallet.id,
        result.hash,
        SYSTEM_CONTRACTS.RitualWallet,
        parseEther(amount).toString(),
        '0x',
        'confirmed'
      );

      res.json({
        hash: result.hash,
        amount,
        lockDuration,
        ritualWallet: SYSTEM_CONTRACTS.RitualWallet,
        explorer: `https://explorer.ritualfoundation.org/tx/${result.hash}`,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /wallets/:id/transactions — Transaction history
   */
  app.get('/wallets/:id/transactions', authMiddleware, (req, res) => {
    const wallet = getWallet(param(req.params.id));
    if (!wallet) {
      res.status(404).json({ error: 'Wallet not found' });
      return;
    }
    const limit = parseInt(req.query.limit as string) || 50;
    const transactions = getTransactions(wallet.id, limit);
    res.json({ transactions, count: transactions.length });
  });

  /**
   * GET /wallets/:id/audit — Audit log
   */
  app.get('/wallets/:id/audit', authMiddleware, (req, res) => {
    const wallet = getWallet(param(req.params.id));
    if (!wallet) {
      res.status(404).json({ error: 'Wallet not found' });
      return;
    }
    const limit = parseInt(req.query.limit as string) || 100;
    const audit = getAuditLog(wallet.id, limit);
    res.json({ audit, count: audit.length });
  });

  /**
   * PATCH /wallets/:id/policy — Update wallet policy
   */
  app.patch('/wallets/:id/policy', authMiddleware, validate(UpdatePolicySchema), (req, res) => {
    const wallet = getWallet(param(req.params.id));
    if (!wallet) {
      res.status(404).json({ error: 'Wallet not found' });
      return;
    }
    if (!assertOwnsWallet(req, res, wallet.id)) return;
    updatePolicy(wallet.id, req.body);
    const updated = getPolicy(wallet.id);
    res.json({ policy: updated });
  });

  /**
   * POST /wallets/:id/freeze — Emergency freeze a wallet
   */
  app.post('/wallets/:id/freeze', authMiddleware, (req, res) => {
    const wallet = getWallet(param(req.params.id));
    if (!wallet) {
      res.status(404).json({ error: 'Wallet not found' });
      return;
    }
    if (!assertOwnsWallet(req, res, wallet.id)) return;
    updateWalletStatus(wallet.id, 'frozen');
    updatePolicy(wallet.id, { frozen: true });
    emitEvent({
      type: 'wallet.frozen',
      walletId: wallet.id,
      data: {
        walletId: wallet.id,
        address: wallet.address,
        previousStatus: wallet.status,
        newStatus: 'frozen',
      },
    } as any);
    res.json({ status: 'frozen', walletId: wallet.id });
  });

  /**
   * POST /wallets/:id/fund — Claim a one-time faucet drip
   */
  app.post('/wallets/:id/fund', authMiddleware, async (req, res, next) => {
    try {
      const walletId = param(req.params.id);
      if (!assertOwnsWallet(req, res, walletId)) return;
      const result = await fundWalletFromFaucet(walletId);

      // Emit wallet.funded event
      emitEvent({
        type: 'wallet.funded',
        walletId,
        data: {
          walletId,
          address: result.to,
          amount: result.amount,
          hash: result.hash,
        },
      } as any);

      res.json(result);
    } catch (err) {
      if (err instanceof FaucetError) {
        const status =
          err.code === 'disabled' ? 503
          : err.code === 'wallet_not_found' ? 404
          : err.code === 'already_funded' ? 409
          : err.code === 'faucet_insufficient_funds' ? 503
          : err.code === 'daily_cap_exceeded' ? 429
          : 500;
        res.status(status).json({ error: err.message, code: err.code });
        return;
      }
      next(err);
    }
  });

  /**
   * POST /wallets/:id/unfreeze — Unfreeze a wallet
   */
  app.post('/wallets/:id/unfreeze', authMiddleware, (req, res) => {
    const wallet = getWallet(param(req.params.id));
    if (!wallet) {
      res.status(404).json({ error: 'Wallet not found' });
      return;
    }
    if (!assertOwnsWallet(req, res, wallet.id)) return;
    updateWalletStatus(wallet.id, 'active');
    updatePolicy(wallet.id, { frozen: false });
    emitEvent({
      type: 'wallet.unfrozen',
      walletId: wallet.id,
      data: {
        walletId: wallet.id,
        address: wallet.address,
        previousStatus: wallet.status,
        newStatus: 'active',
      },
    } as any);
    res.json({ status: 'active', walletId: wallet.id });
  });

  /**
   * POST /wallets/:id/export-key — Export private key for external use
   *
   * ⚠️ DANGER: This exposes the private key in plaintext!
   * Only use to export to MetaMask, Rabby, or other external wallets.
   * After export, the wallet should be considered "compromised" - the user
   * has full control and Ritkey can no longer guarantee security.
   *
   * Requires:
   * - agentShard (caller's share)
   * - backupShard (optional - if provided, uses agent+backup; otherwise server+agent)
   * - confirm: true (explicit confirmation)
   *
   * Recommended: sweep funds to a new wallet after export.
   */
  app.post('/wallets/:id/export-key', authMiddleware, validate(ExportKeySchema), async (req, res, next) => {
    try {
      const wallet = getWallet(param(req.params.id));
      if (!wallet) {
        res.status(404).json({ error: 'Wallet not found' });
        return;
      }
      if (!assertOwnsWallet(req, res, wallet.id)) return;
      if (wallet.status === 'archived') {
        res.status(403).json({
          error: 'Wallet already archived (likely already exported). Cannot re-export.',
          code: 'wallet_archived',
        });
        return;
      }
      if (wallet.status !== 'active') {
        res.status(403).json({ error: `Wallet is ${wallet.status}`, code: 'wallet_not_active' });
        return;
      }

      if (wallet.walletType !== 'threshold') {
        res.status(400).json({
          error: 'Export only supported for threshold wallets',
          walletType: wallet.walletType,
        });
        return;
      }

      const { agentShard, backupShard } = req.body as {
        agentShard: string;
        backupShard?: string;
        confirm: true;
      };

      // Collect shares: prefer agent+backup if both provided (user-controlled),
      // otherwise use server+agent
      const shares: string[] = [];
      if (backupShard) {
        shares.push(agentShard, backupShard);
      } else {
        const encryptionKey = loadConfig().encryptionKey;
        const serverShard = decryptShard(wallet.serverShard, encryptionKey);
        shares.push(serverShard, agentShard);
      }

      // Reconstruct private key
      const privateKey = exportPrivateKey(shares);

      // Audit log this export (critical security event)
      logAudit(
        wallet.id,
        'private_key_exported',
        `Method: ${backupShard ? 'agent+backup' : 'server+agent'}`
      );

      // SECURITY: after export, the user has the full key. Ritkey can no
      // longer guarantee security of this wallet. Archive + freeze so
      // subsequent /send /sign /deposit-ritual /export-key are rejected.
      updateWalletStatus(wallet.id, 'archived');
      updatePolicy(wallet.id, { frozen: true });

      // Emit key.exported event (CRITICAL security event)
      emitEvent({
        type: 'key.exported',
        walletId: wallet.id,
        data: {
          walletId: wallet.id,
          address: wallet.address,
          method: backupShard ? 'agent+backup' : 'server+agent',
        },
      } as any);

      res.json({
        walletId: wallet.id,
        address: wallet.address,
        privateKey,
        status: 'archived',
        _warning: '⚠️ KEEP THIS PRIVATE KEY SECRET! Anyone with it controls your wallet.',
        _security: 'Your wallet is now considered exported. Consider sweeping funds to a new wallet.',
        _instructions: {
          metamask: 'Import via: MetaMask → Account → Import Account → Private Key',
          rabby: 'Import via: Rabby → Add Wallet → Import Private Key',
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /wallets/import — Import an existing private key into Ritkey
   *
   * Use cases:
   * - User has private key from MetaMask/Rabby and wants Ritkey management
   * - Recovery after data loss (user has private key backup)
   * - Moving wallet from another agent/service
   *
   * The private key is split into Shamir 2-of-3 shares. Server stores share 1
   * (encrypted), user receives shares 2 (agent) and 3 (backup).
   *
   * The wallet address will be IDENTICAL to the original key's address.
   */
  app.post('/wallets/import', authMiddleware, validate(ImportKeySchema), (req, res, next) => {
    try {
      const { privateKey, label } = req.body as { privateKey: string; label: string };
      const apiKeyHash = req.apiKeyHash ?? null;

      // Sybil defense: 1 wallet per API key
      if (apiKeyHash) {
        const existing = getApiKeyGrant(apiKeyHash);
        if (existing) {
          res.status(409).json({
            error: 'This API key already owns a wallet. Cannot import another.',
            code: 'api_key_already_bound',
            walletId: existing.walletId,
          });
          return;
        }
      }

      // Normalize private key (ensure 0x prefix)
      const normalizedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

      // Import: split into Shamir 2-of-3 shares
      const imported = importPrivateKey(normalizedKey);

      // M3: do NOT leak whether this address is already managed by Ritkey
      // (or by which tenant). Return a generic conflict that's the same as
      // a sybil violation.
      const existing = getWalletByAddress(imported.address);
      if (existing) {
        res.status(409).json({
          error: 'Cannot import this wallet',
          code: 'import_conflict',
        });
        return;
      }

      // Encrypt shards for storage
      const encryptionKey = loadConfig().encryptionKey;
      const encryptedServerShard = encryptShard(imported.shares[0], encryptionKey);
      const encryptedBackupShard = encryptShard(imported.shares[2], encryptionKey);

      // Store wallet
      const wallet = dbCreateWallet(
        imported.address,
        imported.publicKey,
        encryptedServerShard,
        label || 'Imported Wallet',
        encryptedBackupShard,
        'threshold',
        imported.threshold,
        imported.totalShares
      );

      // Bind to API key
      if (apiKeyHash) {
        const claimed = claimApiKeyGrant(apiKeyHash, wallet.id);
        if (!claimed) {
          updateWalletStatus(wallet.id, 'archived');
          res.status(409).json({
            error: 'API key already owns a wallet (race detected)',
            code: 'api_key_already_bound',
          });
          return;
        }
      }

      logAudit(wallet.id, 'wallet_imported', `Address: ${imported.address}`);

      // Emit wallet.imported event
      emitEvent({
        type: 'wallet.imported',
        walletId: wallet.id,
        data: {
          walletId: wallet.id,
          address: wallet.address,
          label: wallet.label,
        },
      } as any);

      res.status(201).json({
        walletId: wallet.id,
        address: wallet.address,
        publicKey: wallet.publicKey,
        agentShard: imported.shares[1],
        backupShard: imported.shares[2],
        walletType: 'threshold',
        threshold: imported.threshold,
        totalShares: imported.totalShares,
        label: wallet.label,
        createdAt: wallet.createdAt,
        _notice: 'WALLET IMPORTED! Save your agentShard and backupShard. They are shown only once.',
        _security: 'Original private key was used to derive shares. Consider deleting any copies of the original private key for maximum security.',
      });
    } catch (err) {
      if (req.apiKeyHash) revertApiKeyGrant(req.apiKeyHash);
      next(err);
    }
  });

  /**
   * POST /wallets/:id/sweep-and-archive — Sweep funds and archive wallet
   *
   * Sweeps all native balance to a target address, then marks the wallet as
   * archived and releases the API-key grant so a new wallet can be created.
   *
   * Body: { agentShard, sweepTo }
   */
  app.post('/wallets/:id/sweep-and-archive', authMiddleware, validate(SweepAndArchiveSchema), async (req, res, next) => {
    try {
      const walletId = param(req.params.id);
      const { agentShard, sweepTo } = req.body;

      const wallet = getWallet(walletId);
      if (!wallet) {
        res.status(404).json({ error: 'Wallet not found' });
        return;
      }
      if (!assertOwnsWallet(req, res, wallet.id)) return;

      if (wallet.status === 'archived') {
        res.status(409).json({ error: 'Wallet already archived', walletId });
        return;
      }

      // Check balance
      const balance = await getNativeBalance(wallet.address as Address);
      const balanceWei = BigInt(balance.wei);

      let sweepTxHash: Hex | null = null;

      // Sweep if balance > 0
      if (balanceWei > 0n) {
        const config = loadConfig();
        const encryptionKey = config.encryptionKey;
        const serverShard = decryptShard(wallet.serverShard, encryptionKey);

        // Estimate gas for a simple transfer (21000 gas standard)
        const gasPrice = await getPublicClient().getGasPrice();
        const gasLimit = 21000n;
        const gasCost = gasPrice * gasLimit;

        if (balanceWei <= gasCost) {
          res.status(400).json({
            error: 'Balance too low to cover gas',
            balance: balance.formatted,
            gasCost: (gasCost / 10n ** 18n).toString(),
          });
          return;
        }

        const sweepAmount = balanceWei - gasCost;

        // Sign and send sweep transaction
        const result = await signAndSendTransaction(serverShard, agentShard, {
          to: sweepTo as Address,
          value: (sweepAmount / 10n ** 18n).toString(), // Convert wei to ether string
          gas: gasLimit,
        });

        sweepTxHash = result.hash;

        recordTransaction(
          wallet.id,
          result.hash,
          sweepTo,
          sweepAmount.toString(),
          '0x',
          'confirmed'
        );
      }

      // Archive wallet and release API-key grant
      updateWalletStatus(wallet.id, 'archived');
      updatePolicy(wallet.id, { frozen: true });

      if (req.apiKeyHash) {
        revertApiKeyGrant(req.apiKeyHash);
      }

      // Emit wallet.swept event
      emitEvent({
        type: 'wallet.swept',
        walletId: wallet.id,
        data: {
          walletId: wallet.id,
          address: wallet.address,
          sweepTo,
          sweepTxHash,
          swept: balanceWei > 0n,
        },
      } as any);

      res.json({
        status: 'archived',
        walletId: wallet.id,
        swept: balanceWei > 0n,
        sweepTxHash,
        sweepTo,
        apiKeyGrantReleased: !!req.apiKeyHash,
      });
    } catch (err) {
      next(err);
    }
  });

  // ══════════════════════════════════════════════════════════
  //  WEBHOOK ENDPOINTS
  // ══════════════════════════════════════════════════════════
  registerWebhookRoutes(app);

  // ══════════════════════════════════════════════════════════
  //  ALERT ENDPOINTS
  // ══════════════════════════════════════════════════════════
  registerAlertRoutes(app);

  // Initialize webhook secret encryption (H3) and start delivery worker.
  // Fire-and-forget: if this fails the first webhook create will surface the error.
  void ensureWebhookCryptoReady().catch((err) => {
    console.error('[startup] failed to initialize webhook crypto:', err);
  });
  startDeliveryWorker();
  startBalancePoller();
  startChainIndexer();

  // ── Error Handler ─────────────────────────────────────────
  app.use(errorHandler);

  return app;
}
