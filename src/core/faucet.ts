import { parseEther, type Address, type Hex } from 'viem';
import { loadConfig } from './config.js';
import {
  sendTransaction,
  getNativeBalance,
  ritualChain,
} from './ritual.js';
import {
  claimFundingSlot,
  revertFundingClaim,
  recordTransaction,
  getWallet,
  logAudit,
  type WalletRecord,
} from '../db/database.js';
import { privateKeyToAccount } from 'viem/accounts';

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

  // Atomically reserve the claim slot
  const claimed = claimFundingSlot(walletId);
  if (!claimed) {
    throw new FaucetError(
      'Wallet has already claimed from the faucet',
      'already_funded'
    );
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
