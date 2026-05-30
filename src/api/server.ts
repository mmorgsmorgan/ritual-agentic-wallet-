import express from 'express';
import { type Address, type Hex, parseEther, formatEther } from 'viem';
import path from 'path';
import { fileURLToPath } from 'url';

import { generateWalletKeypair, splitKey, encryptShard, decryptShard, reconstructKey } from '../core/keys.js';
import { signAndSendTransaction, signMessage } from '../core/signer.js';
import { policyEngine } from '../core/policy.js';
import { loadConfig } from '../core/config.js';
import { fundWalletFromFaucet, FaucetError } from '../core/faucet.js';
import {
  getNativeBalance,
  getRitualWalletBalance,
  depositToRitualWallet,
  getTransactionReceipt as getRitualReceipt,
  getCurrentBlock,
  SYSTEM_CONTRACTS,
  PRECOMPILES,
  getPublicClient,
} from '../core/ritual.js';
import {
  createWallet as dbCreateWallet,
  getWallet,
  listWallets,
  getPolicy,
  updatePolicy,
  recordTransaction,
  getTransactions,
  getRecentTransactions,
  getAuditLog,
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
} from './middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Extract a route param as a string (Express 5 returns string | string[]) */
function param(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] || '';
  return val || '';
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
   * Returns the wallet ID, address, and the agent's key shard.
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

      // 1. Generate keypair
      const keypair = generateWalletKeypair();

      // 2. Split into server + agent shards
      const split = splitKey(keypair.privateKey);

      // 3. Encrypt server shard for at-rest storage
      const encryptionKey = loadConfig().encryptionKey;
      const encryptedServerShard = encryptShard(split.serverShard, encryptionKey);

      // 4. Store wallet, then bind to api-key-hash. If the bind loses a race
      //    against a concurrent request, delete the wallet and return 409.
      const wallet = dbCreateWallet(
        split.address,
        split.publicKey,
        encryptedServerShard,
        label
      );

      if (apiKeyHash) {
        const claimed = claimApiKeyGrant(apiKeyHash, wallet.id);
        if (!claimed) {
          // Lost the race — clean up the orphan wallet so we don't leak a shard
          updateWalletStatus(wallet.id, 'archived');
          res.status(409).json({
            error: 'This API key already owns a wallet (race detected).',
            code: 'api_key_already_bound',
          });
          return;
        }
      }

      // 5. Return wallet info + agent shard (ONE TIME ONLY)
      res.status(201).json({
        walletId: wallet.id,
        address: wallet.address,
        publicKey: wallet.publicKey,
        agentShard: split.agentShard,
        label: wallet.label,
        createdAt: wallet.createdAt,
        _notice: 'SAVE YOUR AGENT SHARD! It is shown only once and is required for all signing operations.',
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
   */
  app.post('/wallets/:id/send', authMiddleware, validate(SendTransactionSchema), async (req, res, next) => {
    try {
      const wallet = getWallet(param(req.params.id));
      if (!wallet) {
        res.status(404).json({ error: 'Wallet not found' });
        return;
      }
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

      // Decrypt server shard
      const encryptionKey = loadConfig().encryptionKey;
      const serverShard = decryptShard(wallet.serverShard, encryptionKey);

      // Sign and send
      const result = await signAndSendTransaction(serverShard, agentShard, {
        to: to as Address,
        value,
        data: data as Hex,
      });

      // Record transaction
      recordTransaction(
        wallet.id,
        result.hash,
        to,
        parseEther(value).toString(),
        data,
        'confirmed'
      );

      res.json({
        hash: result.hash,
        from: result.from,
        to: result.to,
        value,
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

      const { agentShard, message } = req.body as {
        agentShard: string;
        message: string;
      };

      const encryptionKey = loadConfig().encryptionKey;
      const serverShard = decryptShard(wallet.serverShard, encryptionKey);

      const result = await signMessage(serverShard, agentShard, message);

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
    updateWalletStatus(wallet.id, 'frozen');
    updatePolicy(wallet.id, { frozen: true });
    res.json({ status: 'frozen', walletId: wallet.id });
  });

  /**
   * POST /wallets/:id/fund — Claim a one-time faucet drip
   */
  app.post('/wallets/:id/fund', authMiddleware, async (req, res, next) => {
    try {
      const result = await fundWalletFromFaucet(param(req.params.id));
      res.json(result);
    } catch (err) {
      if (err instanceof FaucetError) {
        const status =
          err.code === 'disabled' ? 503
          : err.code === 'wallet_not_found' ? 404
          : err.code === 'already_funded' ? 409
          : err.code === 'faucet_insufficient_funds' ? 503
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
    updateWalletStatus(wallet.id, 'active');
    updatePolicy(wallet.id, { frozen: false });
    res.json({ status: 'active', walletId: wallet.id });
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

  // ── Error Handler ─────────────────────────────────────────
  app.use(errorHandler);

  return app;
}
