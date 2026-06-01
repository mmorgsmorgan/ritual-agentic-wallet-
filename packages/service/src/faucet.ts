import { parseEther, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadConfig, sendTransaction, getNativeBalance, ritualChain } from '@ritkey/core';
import {
  revertFundingClaim,
  recordTransaction,
  getWallet,
  logAudit,
  recordFaucetClaim,
  tryClaimFaucetSlot,
  type WalletRecord,
} from './db/database.js';

export interface FaucetResult {
  hash: Hex;
  from: Address;
  to: Address;
  amount: string;
  explorer: string;
}

export class FaucetError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'disabled'
      | 'wallet_not_found'
      | 'already_funded'
      | 'faucet_insufficient_funds'
      | 'daily_cap_exceeded'
  ) {
    super(message);
  }
}

/**
 * Drip the configured faucet amount to the given wallet, exactly once.
 * Concurrency-safe via atomic UPDATE … WHERE funded_at IS NULL.
 */
export async function fundWalletFromFaucet(
  walletId: string
): Promise<FaucetResult> {
  const config = loadConfig();
  if (!config.faucetPrivateKey) {
    throw new FaucetError(
      'Faucet is not configured. Set FAUCET_PRIVATE_KEY to enable.',
      'disabled'
    );
  }

  const wallet: WalletRecord | undefined = getWallet(walletId);
  if (!wallet) {
    throw new FaucetError('Wallet not found', 'wallet_not_found');
  }

  // M1: atomically check the daily cap AND claim the per-wallet slot in
  // a single transaction. Eliminates the TOCTOU between cap-read and claim.
  const slot = tryClaimFaucetSlot(walletId, config.faucetAmount, config.faucetDailyCap);
  if (!slot.ok) {
    if (slot.reason === 'cap_exceeded') {
      throw new FaucetError(
        `Daily faucet cap of ${config.faucetDailyCap} RITUAL would be exceeded. Today's total: ${slot.todayTotal} RITUAL`,
        'daily_cap_exceeded'
      );
    }
    throw new FaucetError('Wallet has already claimed from the faucet', 'already_funded');
  }

  try {
    const faucetAccount = privateKeyToAccount(
      config.faucetPrivateKey as `0x${string}`
    );
    const amountWei = parseEther(config.faucetAmount);

    // Cheap check before broadcasting (avoid wasted nonce on guaranteed failure)
    const faucetBalance = await getNativeBalance(faucetAccount.address);
    if (faucetBalance.wei < amountWei) {
      throw new FaucetError(
        `Faucet wallet ${faucetAccount.address} has ${faucetBalance.formatted} RITUAL, needs ${config.faucetAmount}`,
        'faucet_insufficient_funds'
      );
    }

    const { hash } = await sendTransaction(
      config.faucetPrivateKey,
      wallet.address as Address,
      amountWei
    );

    recordTransaction(
      walletId,
      hash,
      wallet.address,
      amountWei.toString(),
      '0x',
      'confirmed'
    );
    recordFaucetClaim(walletId, config.faucetAmount);
    logAudit(walletId, 'faucet_funded', `Amount: ${config.faucetAmount} RITUAL, Hash: ${hash}`);

    return {
      hash,
      from: faucetAccount.address,
      to: wallet.address as Address,
      amount: config.faucetAmount,
      explorer: `https://explorer.ritualfoundation.org/tx/${hash}`,
    };
  } catch (err) {
    // Roll back the claim so the wallet can retry (or be reviewed)
    revertFundingClaim(walletId);
    throw err;
  }
}

/** Re-export the chain reference so callers can introspect if needed. */
export { ritualChain };
