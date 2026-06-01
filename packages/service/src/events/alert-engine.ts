/**
 * Alert engine.
 *
 * Hooked into the event emitter via `evaluateAndEmitAlerts(event)`. The
 * emitter calls this AFTER persisting the low-level event but BEFORE
 * enqueueing webhook deliveries, so any derived alert.* events fan out
 * in the same pass.
 *
 * The engine is stateless beyond the rules table — each event is
 * evaluated independently. Rate-limiting / debouncing of alerts is up
 * to the subscriber (use Ritkey-Event-Id for dedup).
 */

import { listRulesForWallet, type AlertRule } from './alert-rules.js';
import type { RitkeyEvent } from './types.js';

/**
 * Evaluate alert rules for an incoming event and return any derived
 * alert events. The caller is responsible for persisting + enqueuing.
 *
 * Returns a list of "draft" events (without id/timestamp). They'll be
 * stamped by emitEvent when the caller fans them out.
 */
export function evaluateAlerts(
  event: RitkeyEvent
): Array<Omit<RitkeyEvent, 'id' | 'timestamp'>> {
  // Alerts are per-wallet; system events without a wallet aren't alertable.
  if (!event.walletId) return [];

  // Don't recurse on already-derived alert events.
  if (event.type.startsWith('alert.')) return [];

  const rules = listRulesForWallet(event.walletId);
  if (rules.length === 0) return [];

  const out: Array<Omit<RitkeyEvent, 'id' | 'timestamp'>> = [];

  for (const rule of rules) {
    try {
      const derived = applyRule(rule, event);
      if (derived) out.push(derived);
    } catch (err) {
      // Never let a single bad rule break event delivery.
      console.error(
        `[alert-engine] rule ${rule.id} (kind=${rule.kind}) threw:`,
        err
      );
    }
  }
  return out;
}

function applyRule(
  rule: AlertRule,
  event: RitkeyEvent
): Omit<RitkeyEvent, 'id' | 'timestamp'> | null {
  switch (rule.kind) {
    case 'spend_threshold': {
      if (event.type !== 'tx.sent') return null;
      const cfg = rule.config as { thresholdRitual: string };
      const txVal = parseFloat((event.data as any).valueFormatted ?? '0');
      const threshold = parseFloat(cfg.thresholdRitual);
      if (!Number.isFinite(txVal) || !Number.isFinite(threshold)) return null;
      if (txVal <= threshold) return null;
      return {
        type: 'alert.spend_threshold',
        walletId: event.walletId,
        data: {
          ruleId: rule.id,
          walletId: event.walletId!,
          severity: rule.severity,
          thresholdRitual: cfg.thresholdRitual,
          txValueRitual: (event.data as any).valueFormatted,
          txHash: (event.data as any).hash,
          to: (event.data as any).to,
          triggeringEventId: event.id,
        },
      } as any;
    }

    case 'unusual_recipient': {
      if (event.type !== 'tx.sent') return null;
      const cfg = rule.config as { whitelist: string[] };
      const to = String((event.data as any).to ?? '').toLowerCase();
      const whitelist = new Set(cfg.whitelist.map((a) => a.toLowerCase()));
      if (whitelist.has(to)) return null;
      return {
        type: 'alert.unusual_recipient',
        walletId: event.walletId,
        data: {
          ruleId: rule.id,
          walletId: event.walletId!,
          severity: rule.severity,
          to: (event.data as any).to,
          txHash: (event.data as any).hash,
          txValueRitual: (event.data as any).valueFormatted ?? '0',
          triggeringEventId: event.id,
        },
      } as any;
    }

    case 'key_export_warning': {
      if (event.type !== 'key.exported') return null;
      return {
        type: 'alert.key_export_warning',
        walletId: event.walletId,
        data: {
          ruleId: rule.id,
          walletId: event.walletId!,
          severity: 'critical',
          address: (event.data as any).address,
          method: (event.data as any).method,
          triggeringEventId: event.id,
        },
      } as any;
    }

    case 'balance_low': {
      // Driven by the balance poller (events/balance-poller.ts), not the
      // event stream. The poller emits alert.balance_low directly with
      // hysteresis tracking. Returning null here keeps balance_low rules
      // from being triggered by unrelated events.
      return null;
    }
  }
}
