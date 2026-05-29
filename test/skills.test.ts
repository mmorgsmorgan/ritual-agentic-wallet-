import { describe, it, expect } from 'vitest';
import {
  listRitualSkills,
  getRitualSkill,
  getRitualRules,
  loadRitualSkills,
} from '../src/core/skills.js';

describe('ritual skill registry', () => {
  it('loads all bundled skills', () => {
    const skills = listRitualSkills();
    expect(skills.length).toBeGreaterThanOrEqual(10);
    const ids = skills.map((s) => s.id).sort();
    expect(ids).toContain('ritual-dapp-overview');
    expect(ids).toContain('ritual-dapp-wallet');
    expect(ids).toContain('ritual-dapp-http');
    expect(ids).toContain('ritual-dapp-llm');
    expect(ids).toContain('ritual-dapp-precompiles');
  });

  it('parses frontmatter — every skill has a description', () => {
    for (const skill of listRitualSkills()) {
      expect(skill.description.length).toBeGreaterThan(0);
    }
  });

  it('returns the full markdown body via getRitualSkill', () => {
    const http = getRitualSkill('ritual-dapp-http');
    expect(http).toBeTruthy();
    expect(http!.body).toContain('0x0801');
    expect(http!.body).toContain('HTTP_REQUEST_ABI');
    // Frontmatter should NOT be in the body
    expect(http!.body.startsWith('---')).toBe(false);
  });

  it('returns undefined for unknown skill ids', () => {
    expect(getRitualSkill('does-not-exist')).toBeUndefined();
  });

  it('exposes the curated RULES.md', () => {
    const rules = getRitualRules();
    expect(rules).toContain('Chain ID:** 1979');
    expect(rules).toContain('13 fields');
    expect(rules).toContain('30 fields');
    expect(rules).toContain('EIP-1559');
  });

  it('caches loaded skills (loadRitualSkills returns same Map)', () => {
    const a = loadRitualSkills();
    const b = loadRitualSkills();
    expect(a).toBe(b);
  });
});

describe('ritual rules content', () => {
  it('mentions the canonical RitualWallet address', () => {
    expect(getRitualRules()).toContain('0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948');
  });

  it('mentions the canonical TEEServiceRegistry address', () => {
    expect(getRitualRules()).toContain('0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F');
  });

  it('warns about Type-0 (legacy) tx rejection', () => {
    expect(getRitualRules()).toMatch(/Type-0|legacy/i);
  });
});
