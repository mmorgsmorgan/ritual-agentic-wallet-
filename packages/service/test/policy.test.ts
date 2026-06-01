import { describe, it, expect, beforeEach } from 'vitest';
import { policyEngine, DEFAULT_POLICY, type WalletPolicy } from '@ritkey/core';
import { type Address } from 'viem';

const TO: Address = '0x000000000000000000000000000000000000dEaD';
const ALT: Address = '0x000000000000000000000000000000000000bEEF';

function policy(overrides: Partial<WalletPolicy> = {}): WalletPolicy {
  return { ...DEFAULT_POLICY, ...overrides };
}

describe('policyEngine.evaluate', () => {
  describe('frozen flag', () => {
    it('blocks when frozen', () => {
      const result = policyEngine.evaluate(policy({ frozen: true }), TO, '0.1', []);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/frozen/i);
    });
  });

  describe('per-tx limit', () => {
    it('allows transactions at exactly the limit', () => {
      const result = policyEngine.evaluate(policy({ maxPerTransaction: '1.0' }), TO, '1.0', []);
      expect(result.allowed).toBe(true);
    });

    it('blocks transactions over the limit', () => {
      const result = policyEngine.evaluate(policy({ maxPerTransaction: '1.0' }), TO, '1.5', []);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/per-tx limit/);
    });
  });

  describe('whitelist', () => {
    it('allows whitelisted destinations', () => {
      const result = policyEngine.evaluate(
        policy({ allowedAddresses: [TO] }),
        TO,
        '0.1',
        []
      );
      expect(result.allowed).toBe(true);
    });

    it('blocks non-whitelisted destinations', () => {
      const result = policyEngine.evaluate(
        policy({ allowedAddresses: [TO] }),
        ALT,
        '0.1',
        []
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/allowed address/);
    });

    it('is case-insensitive on the destination', () => {
      const result = policyEngine.evaluate(
        policy({ allowedAddresses: [TO.toLowerCase() as Address] }),
        TO.toUpperCase() as Address,
        '0.1',
        []
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe('daily cap (24h rolling)', () => {
    it('allows when sum stays under cap', () => {
      const recent = [
        { walletId: 'w', value: '1000000000000000000', timestamp: Date.now() - 1000 }, // 1 RITUAL
      ];
      const result = policyEngine.evaluate(
        policy({ maxDailySpend: '5.0', maxPerTransaction: '5.0' }),
        TO,
        '1.0',
        recent
      );
      expect(result.allowed).toBe(true);
    });

    it('blocks when sum would exceed cap', () => {
      const recent = [
        { walletId: 'w', value: '4000000000000000000', timestamp: Date.now() - 1000 }, // 4 RITUAL
      ];
      const result = policyEngine.evaluate(
        policy({ maxDailySpend: '5.0', maxPerTransaction: '5.0' }),
        TO,
        '2.0',
        recent
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Daily spending/);
    });

    it('ignores transactions older than 24h', () => {
      const recent = [
        { walletId: 'w', value: '4000000000000000000', timestamp: Date.now() - 25 * 60 * 60 * 1000 },
      ];
      const result = policyEngine.evaluate(
        policy({ maxDailySpend: '5.0', maxPerTransaction: '5.0' }),
        TO,
        '2.0',
        recent
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe('rate limit', () => {
    it('blocks when too many transactions in last minute', () => {
      const now = Date.now();
      const recent = Array.from({ length: 10 }, (_, i) => ({
        walletId: 'w',
        value: '1',
        timestamp: now - i * 1000,
      }));
      const result = policyEngine.evaluate(
        policy({ maxTxPerMinute: 10 }),
        TO,
        '0.001',
        recent
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Rate limit/);
    });

    it('counts only transactions within the last minute', () => {
      const recent = Array.from({ length: 20 }, (_, i) => ({
        walletId: 'w',
        value: '1',
        timestamp: Date.now() - 2 * 60 * 1000 - i * 1000, // 2+ min old
      }));
      const result = policyEngine.evaluate(
        policy({ maxTxPerMinute: 10 }),
        TO,
        '0.001',
        recent
      );
      expect(result.allowed).toBe(true);
    });
  });
});
