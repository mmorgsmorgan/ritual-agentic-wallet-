/**
 * Typed event poller.
 *
 * For apps that don't want to operate a public HTTPS endpoint, the SDK can
 * poll `GET /events` and emit events to callbacks. This is the fallback for
 * environments where webhooks aren't practical (CLIs, scripts, dev loops).
 *
 * Production traffic should still use webhooks — polling is rate-limited
 * by the underlying service and burns more API budget.
 *
 * Usage:
 *   const stop = client.events.subscribe({
 *     types: ['tx.sent', 'wallet.funded'],
 *     onEvent: (event) => console.log(event),
 *   });
 *   // ... later
 *   stop();
 */

import type { HttpTransport } from '../transport.js';
import type { RitkeyEvent, EventType } from '../types.js';

export interface SubscribeOptions {
  /** Subset of event types to filter on. Default: all. */
  types?: EventType[];
  /** Restrict to a specific wallet. */
  walletId?: string;
  /** Maximum events to fetch per poll. Default: 50. */
  batchSize?: number;
  /** Poll interval in milliseconds. Default: 3000. */
  intervalMs?: number;
  /** Per-event callback. */
  onEvent: (event: RitkeyEvent) => void | Promise<void>;
  /** Optional error handler. If not set, errors are logged with console.error. */
  onError?: (err: unknown) => void;
}

/** Returned by subscribe() — call it to stop polling. */
export type StopFn = () => void;

interface ListEventsResponse {
  events: RitkeyEvent[];
  count: number;
}

export class EventsClient {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Subscribe to events via polling. Returns a stop function.
   *
   * The poller tracks the most-recent event id it has seen to avoid emitting
   * duplicates across polls (server returns events newest-first by created_at;
   * we de-dupe client-side using id).
   */
  subscribe(opts: SubscribeOptions): StopFn {
    const intervalMs = opts.intervalMs ?? 3000;
    const batchSize = opts.batchSize ?? 50;
    const filterTypes = opts.types ? new Set(opts.types) : null;
    const seenIds = new Set<string>();
    // Don't replay the existing event backlog on first poll — only emit
    // events we observe AFTER subscribe() is called. We seed `seenIds` with
    // the current tail of the log on first fetch.
    let primed = false;
    let stopped = false;

    const poll = async (): Promise<void> => {
      if (stopped) return;
      try {
        const qs: string[] = [`limit=${batchSize}`];
        if (opts.walletId) qs.push(`walletId=${encodeURIComponent(opts.walletId)}`);
        // We don't pass `type=` because we may want to subscribe to N types;
        // we filter client-side instead.
        const res = await this.http.request<ListEventsResponse>(
          'GET',
          `/events?${qs.join('&')}`
        );

        const events = res.events ?? [];

        if (!primed) {
          // Seed the seen-set with everything currently in the log;
          // we don't replay history.
          for (const ev of events) seenIds.add(ev.id);
          primed = true;
          return;
        }

        // Emit newest events we haven't seen yet, in chronological order.
        const fresh = events.filter((ev) => !seenIds.has(ev.id)).reverse();
        for (const ev of fresh) {
          seenIds.add(ev.id);
          if (filterTypes && !filterTypes.has(ev.type)) continue;
          try {
            await opts.onEvent(ev);
          } catch (handlerErr) {
            if (opts.onError) opts.onError(handlerErr);
            else console.error('[ritkey/sdk] event handler threw:', handlerErr);
          }
        }

        // Prevent seenIds from growing unbounded. Keep last ~10k.
        if (seenIds.size > 10_000) {
          const overflow = seenIds.size - 5_000;
          const it = seenIds.values();
          for (let i = 0; i < overflow; i++) {
            const next = it.next();
            if (next.done) break;
            seenIds.delete(next.value);
          }
        }
      } catch (err) {
        if (opts.onError) opts.onError(err);
        else console.error('[ritkey/sdk] poll failed:', err);
      }
    };

    // Kick off first poll immediately, then on the interval.
    void poll();
    const handle: ReturnType<typeof setInterval> = setInterval(() => void poll(), intervalMs);
    // Don't block process exit on the timer.
    (handle as any).unref?.();

    return () => {
      stopped = true;
      clearInterval(handle);
    };
  }

  /**
   * One-shot fetch of recent events (no polling).
   */
  async list(opts?: {
    walletId?: string;
    type?: EventType;
    limit?: number;
  }): Promise<RitkeyEvent[]> {
    const qs: string[] = [];
    if (opts?.walletId) qs.push(`walletId=${encodeURIComponent(opts.walletId)}`);
    if (opts?.type) qs.push(`type=${encodeURIComponent(opts.type)}`);
    if (opts?.limit) qs.push(`limit=${opts.limit}`);
    const path = `/events${qs.length ? '?' + qs.join('&') : ''}`;
    const res = await this.http.request<ListEventsResponse>('GET', path);
    return res.events ?? [];
  }
}
