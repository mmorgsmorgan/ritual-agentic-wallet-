/**
 * Chain indexer — drives the `tx.received` event.
 *
 * Periodically walks new blocks on Ritual Chain. For each block, scans
 * the tx list for any tx whose `to` matches one of our (non-archived)
 * wallet addresses. For each match, emits a `tx.received` event scoped
 * to the recipient wallet.
 *
 * State (last processed block) is persisted in `indexer_state` so the
 * service can restart without re-scanning. On cold start (no row) we
 * record the current chain head and start emitting from the next block
 * — we do NOT replay history.
 *
 * Bounded per-tick: at most MAX_BLOCKS_PER_TICK blocks are processed.
 * If the indexer falls behind (e.g. service was down for a while), it
 * catches up in chunks rather than blocking the event loop.
 *
 * The fetcher is injectable for tests. Production uses viem's
 * `getPublicClient` from @ritkey/core.
 */
import { formatEther } from 'viem';
import { getDb } from '../db/database.js';
import { emitEvent } from './emitter.js';
import { getPublicClient } from '@ritkey/core';
import type { Address } from 'viem';

const INDEXER_NAME = 'tx-received';
const DEFAULT_INTERVAL_MS = 12 * 1000; // ~Ritual block time
const MAX_BLOCKS_PER_TICK = 50; // catch-up cap so a tick is bounded

// A minimal block view — enough to identify incoming transfers.
export interface IndexerBlock {
  number: bigint;
  transactions: Array<{
    hash: string;
    from: string;
    to: string | null;
    value: bigint;
  }>;
}

export type BlockFetcher = {
  getHead(): Promise<bigint>;
  getBlock(blockNumber: bigint): Promise<IndexerBlock>;
};

let intervalHandle: NodeJS.Timeout | null = null;
let currentFetcher: BlockFetcher = defaultFetcher();

function defaultFetcher(): BlockFetcher {
  return {
    async getHead() {
      const client = getPublicClient();
      return client.getBlockNumber();
    },
    async getBlock(n) {
      const client = getPublicClient();
      const block = await client.getBlock({
        blockNumber: n,
        includeTransactions: true,
      });
      return {
        number: block.number,
        transactions: block.transactions.map((tx) => ({
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: tx.value,
        })),
      };
    },
  };
}

/** Override the chain fetcher. Tests inject a deterministic mock. */
export function setBlockFetcher(f: BlockFetcher | null): void {
  currentFetcher = f ?? defaultFetcher();
}

export function startChainIndexer(opts?: { intervalMs?: number }): void {
  if (intervalHandle) return;
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  intervalHandle = setInterval(() => {
    runChainIndexerOnce().catch((err) => {
      console.error('[chain-indexer] tick failed:', err);
    });
  }, intervalMs);
  if (typeof intervalHandle.unref === 'function') intervalHandle.unref();
}

export function stopChainIndexer(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/**
 * Process one tick. Public so tests can drive it deterministically.
 */
export async function runChainIndexerOnce(): Promise<void> {
  const db = getDb();
  const head = await currentFetcher.getHead();

  const stateRow = db.prepare(
    'SELECT last_block_number FROM indexer_state WHERE name = ?'
  ).get(INDEXER_NAME) as { last_block_number: string } | undefined;

  // Cold start: record current head, skip everything before it.
  if (!stateRow) {
    db.prepare(
      `INSERT INTO indexer_state (name, last_block_number, last_checked_at)
       VALUES (?, ?, ?)`
    ).run(INDEXER_NAME, head.toString(), new Date().toISOString());
    return;
  }

  const last = BigInt(stateRow.last_block_number);
  if (head <= last) {
    // No new blocks since last tick.
    db.prepare(
      'UPDATE indexer_state SET last_checked_at = ? WHERE name = ?'
    ).run(new Date().toISOString(), INDEXER_NAME);
    return;
  }

  // Build the address index once per tick. Tx.to comparisons are lowercase.
  type WalletRow = { id: string; address: string };
  const wallets = db.prepare(
    "SELECT id, address FROM wallets WHERE status != 'archived'"
  ).all() as WalletRow[];
  const addressIndex = new Map<string, string>();
  for (const w of wallets) addressIndex.set(w.address.toLowerCase(), w.id);

  if (addressIndex.size === 0) {
    // No wallets to watch — just bump cursor so we don't keep re-scanning blocks.
    db.prepare(
      `UPDATE indexer_state SET last_block_number = ?, last_checked_at = ? WHERE name = ?`
    ).run(head.toString(), new Date().toISOString(), INDEXER_NAME);
    return;
  }

  const target = last + BigInt(MAX_BLOCKS_PER_TICK) < head
    ? last + BigInt(MAX_BLOCKS_PER_TICK)
    : head;

  for (let n = last + 1n; n <= target; n++) {
    let block: IndexerBlock;
    try {
      block = await currentFetcher.getBlock(n);
    } catch (err) {
      // Skip this block on error — don't advance cursor, will retry next tick.
      console.error(`[chain-indexer] getBlock(${n}) failed:`, err);
      return;
    }

    for (const tx of block.transactions) {
      if (!tx.to) continue;
      const walletId = addressIndex.get(tx.to.toLowerCase());
      if (!walletId) continue;
      if (tx.value === 0n) continue; // ignore zero-value tx

      emitEvent({
        type: 'tx.received',
        walletId,
        data: {
          walletId,
          address: tx.to,
          from: tx.from,
          hash: tx.hash,
          value: tx.value.toString(),
          valueFormatted: formatEther(tx.value),
          blockNumber: block.number.toString(),
          explorer: `https://explorer.ritualfoundation.org/tx/${tx.hash}`,
        },
      } as any);
    }
  }

  db.prepare(
    `UPDATE indexer_state SET last_block_number = ?, last_checked_at = ? WHERE name = ?`
  ).run(target.toString(), new Date().toISOString(), INDEXER_NAME);
}
