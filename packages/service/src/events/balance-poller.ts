/**
 * Balance poller — drives the `balance_low` alert kind.
 *
 * Periodically polls each wallet's native RITUAL balance for every enabled
 * `balance_low` rule and emits `alert.balance_low` when the balance crosses
 * below the configured floor.
 *
 * Hysteresis: once a rule has fired (state = 'tripped'), no further alerts
 * fire until the balance recovers above `floor * ARM_MARGIN`. This avoids
 * a flood of alerts when balance hovers around the floor.
 *
 * State is persisted in `alert_rule_state` so process restarts don't
 * re-fire stale alerts.
 *
 * The fetcher is injectable for tests — production uses on-chain RPC via
 * @ritkey/core's `getNativeBalance`. Tests inject a mock.
 */
import { getDb } from '../db/database.js';
import { emitEvent } from './emitter.js';
import { getNativeBalance } from '@ritkey/core';
import type { Address } from 'viem';

// Balance must recover ARM_MARGIN above floor before the rule re-arms.
// Pure equality would cause re-fires on every poll while balance hovers.
const ARM_MARGIN = 1.05;

// How often (in ms) we poll if not overridden. 5 minutes by default — chain
// balance changes are infrequent and RPC isn't free.
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

export type BalanceFetcher = (address: string) => Promise<string>;

let intervalHandle: NodeJS.Timeout | null = null;
let currentFetcher: BalanceFetcher = defaultFetcher;

async function defaultFetcher(address: string): Promise<string> {
  const r = await getNativeBalance(address as Address);
  return r.formatted;
}

/** Override the on-chain balance fetcher. Used by tests. */
export function setBalanceFetcher(f: BalanceFetcher | null): void {
  currentFetcher = f ?? defaultFetcher;
}

export function startBalancePoller(opts?: { intervalMs?: number }): void {
  if (intervalHandle) return;
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  // Don't run immediately on start — let the rest of init settle first.
  // If a test needs an immediate evaluation it can call `runBalancePollOnce()`.
  intervalHandle = setInterval(() => {
    runBalancePollOnce().catch((err) => {
      console.error('[balance-poller] tick failed:', err);
    });
  }, intervalMs);
  // Keep node from holding the process open just for the poller.
  if (typeof intervalHandle.unref === 'function') intervalHandle.unref();
}

export function stopBalancePoller(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

interface RuleRow {
  rule_id: string;
  wallet_id: string;
  wallet_address: string;
  config: string;
  severity: string;
  state: 'armed' | 'tripped' | null;
}

/**
 * Run one poll cycle. Public so tests can step through deterministically
 * instead of waiting for the timer.
 */
export async function runBalancePollOnce(): Promise<void> {
  const db = getDb();

  // Active balance_low rules attached to an active wallet, joined with any
  // existing state row. NULL state row means the rule hasn't been evaluated
  // yet — treat as 'armed'.
  const rows = db.prepare(
    `SELECT
        r.id           AS rule_id,
        r.wallet_id    AS wallet_id,
        w.address      AS wallet_address,
        r.config       AS config,
        r.severity     AS severity,
        s.state        AS state
     FROM alert_rules r
     JOIN wallets w ON w.id = r.wallet_id
     LEFT JOIN alert_rule_state s ON s.rule_id = r.id AND s.wallet_id = r.wallet_id
     WHERE r.kind = 'balance_low'
       AND r.enabled = 1
       AND w.status = 'active'`
  ).all() as RuleRow[];

  // Cache balances per address so one wallet with N rules only costs one RPC.
  const balanceCache = new Map<string, string>();

  for (const row of rows) {
    let balanceStr: string;
    try {
      const cached = balanceCache.get(row.wallet_address.toLowerCase());
      if (cached !== undefined) {
        balanceStr = cached;
      } else {
        balanceStr = await currentFetcher(row.wallet_address);
        balanceCache.set(row.wallet_address.toLowerCase(), balanceStr);
      }
    } catch (err) {
      console.error(
        `[balance-poller] fetch failed for ${row.wallet_address}:`,
        err
      );
      continue;
    }

    let cfg: { floorRitual: string };
    try {
      cfg = JSON.parse(row.config);
    } catch {
      console.error(`[balance-poller] bad config json for rule ${row.rule_id}`);
      continue;
    }
    const floor = parseFloat(cfg.floorRitual);
    const balance = parseFloat(balanceStr);
    if (!Number.isFinite(floor) || !Number.isFinite(balance)) {
      console.error(
        `[balance-poller] non-numeric balance/floor for rule ${row.rule_id}`
      );
      continue;
    }

    const prevState: 'armed' | 'tripped' = row.state ?? 'armed';
    const armThreshold = floor * ARM_MARGIN;

    let nextState: 'armed' | 'tripped' = prevState;
    let firedAt: string | null = null;

    if (prevState === 'armed' && balance < floor) {
      // Crossed below — fire alert and trip.
      nextState = 'tripped';
      firedAt = new Date().toISOString();
      emitEvent({
        type: 'alert.balance_low',
        walletId: row.wallet_id,
        data: {
          ruleId: row.rule_id,
          walletId: row.wallet_id,
          severity: row.severity,
          floorRitual: cfg.floorRitual,
          balanceRitual: balanceStr,
          address: row.wallet_address,
        },
      } as any);
    } else if (prevState === 'tripped' && balance >= armThreshold) {
      // Recovered above floor + margin — re-arm.
      nextState = 'armed';
    }
    // Else: hold previous state, no event.

    upsertState(row.rule_id, row.wallet_id, nextState, balanceStr, firedAt);
  }
}

function upsertState(
  ruleId: string,
  walletId: string,
  state: 'armed' | 'tripped',
  balanceRitual: string,
  firedAt: string | null
): void {
  const now = new Date().toISOString();
  const existing = getDb().prepare(
    'SELECT last_fired_at FROM alert_rule_state WHERE rule_id = ? AND wallet_id = ?'
  ).get(ruleId, walletId) as { last_fired_at: string | null } | undefined;

  const lastFired = firedAt ?? existing?.last_fired_at ?? null;

  getDb().prepare(
    `INSERT INTO alert_rule_state
       (rule_id, wallet_id, state, last_balance_ritual, last_checked_at, last_fired_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(rule_id, wallet_id) DO UPDATE SET
       state = excluded.state,
       last_balance_ritual = excluded.last_balance_ritual,
       last_checked_at = excluded.last_checked_at,
       last_fired_at = excluded.last_fired_at`
  ).run(ruleId, walletId, state, balanceRitual, now, lastFired);
}
