import { type Address, parseEther, formatEther } from 'viem';

// ============================================================
// Types
// ============================================================

/** Policy configuration for a wallet */
export interface WalletPolicy {
  /** Maximum value per transaction in RITUAL (ether units) */
  maxPerTransaction: string;
  /** Maximum aggregate spending per 24h rolling window in RITUAL */
  maxDailySpend: string;
  /** Optional whitelist of allowed destination addresses (empty = allow all) */
  allowedAddresses: Address[];
  /** Maximum transactions per minute */
  maxTxPerMinute: number;
  /** Whether the wallet is frozen (emergency kill switch) */
  frozen: boolean;
}

/** Default policy for new agent wallets */
export const DEFAULT_POLICY: WalletPolicy = {
  maxPerTransaction: '1.0',  // 1 RITUAL per tx
  maxDailySpend: '5.0',      // 5 RITUAL per day
  allowedAddresses: [],       // allow all destinations
  maxTxPerMinute: 10,         // rate limit
  frozen: false,
};

/** Transaction record for spending tracking */
export interface TransactionRecord {
  walletId: string;
  value: string;  // in wei
  timestamp: number;
}

/** Result of policy evaluation */
export interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

// ============================================================
// Policy Engine
// ============================================================

/**
 * Deterministic policy engine that evaluates transactions against configurable rules.
 * Enforces spending limits, whitelists, rate limits, and freeze status.
 *
 * This is a non-LLM, infrastructure-level enforcement layer — it cannot be
 * bypassed by prompt injection because it runs outside the agent's context.
 */
export class PolicyEngine {
  /**
   * Evaluate a proposed transaction against the wallet's policy.
   */
  evaluate(
    policy: WalletPolicy,
    to: Address,
    valueEther: string,
    recentTransactions: TransactionRecord[]
  ): PolicyResult {
    // 1. Check frozen status (emergency kill switch)
    if (policy.frozen) {
      return {
        allowed: false,
        reason: 'Wallet is frozen. Contact administrator.',
      };
    }

    // 2. Check per-transaction limit
    const txValue = parseEther(valueEther);
    const maxPerTx = parseEther(policy.maxPerTransaction);
    if (txValue > maxPerTx) {
      return {
        allowed: false,
        reason: `Transaction value ${valueEther} RITUAL exceeds per-tx limit of ${policy.maxPerTransaction} RITUAL`,
      };
    }

    // 3. Check destination whitelist (if configured)
    if (policy.allowedAddresses.length > 0) {
      const normalizedTo = to.toLowerCase();
      const allowed = policy.allowedAddresses.some(
        (addr) => addr.toLowerCase() === normalizedTo
      );
      if (!allowed) {
        return {
          allowed: false,
          reason: `Destination ${to} is not in the allowed address list`,
        };
      }
    }

    // 4. Check daily spending limit (24h rolling window)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const dailySpent = recentTransactions
      .filter((tx) => tx.timestamp >= oneDayAgo)
      .reduce((sum, tx) => sum + BigInt(tx.value), 0n);

    const maxDaily = parseEther(policy.maxDailySpend);
    if (dailySpent + txValue > maxDaily) {
      return {
        allowed: false,
        reason: `Daily spending limit reached. Spent: ${formatEther(dailySpent)} RITUAL, Limit: ${policy.maxDailySpend} RITUAL`,
      };
    }

    // 5. Check rate limit (transactions per minute)
    const oneMinuteAgo = Date.now() - 60 * 1000;
    const recentCount = recentTransactions.filter(
      (tx) => tx.timestamp >= oneMinuteAgo
    ).length;
    if (recentCount >= policy.maxTxPerMinute) {
      return {
        allowed: false,
        reason: `Rate limit exceeded. Max ${policy.maxTxPerMinute} transactions per minute`,
      };
    }

    return { allowed: true };
  }
}

/** Singleton policy engine instance */
export const policyEngine = new PolicyEngine();
