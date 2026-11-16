import { describe, expect, test } from 'bun:test';
import {
  isUsageDateRangeValid,
  pricingDraftToModel,
  resolveModelDisplayPrices,
} from '../src/features/usage/model';

const validDraft = {
  provider: ' Antigravity ',
  model: ' gemini-3-pro ',
  input: '1.25',
  output: '10',
  cacheRead: '0.125',
  cacheWrite: '2.5',
};

describe('usage date ranges', () => {
  test('requires both endpoints in ascending order', () => {
    expect(isUsageDateRangeValid('2026-11-01', '2026-11-30')).toBe(true);
    expect(isUsageDateRangeValid('', '2026-11-30')).toBe(false);
    expect(isUsageDateRangeValid('2026-12-01', '2026-11-30')).toBe(false);
  });
});

describe('pricing drafts', () => {
  test('normalizes identity and maps all four price buckets', () => {
    expect(pricingDraftToModel(validDraft)).toEqual({
      provider: 'Antigravity',
      model: 'gemini-3-pro',
      base_prices: { input: 1.25, output: 10, cache_read: 0.125, cache_write: 2.5 },
    });
  });

  test('rejects empty identity, negative prices, and non-numeric prices', () => {
    expect(pricingDraftToModel({ ...validDraft, provider: ' ' })).toBeNull();
    expect(pricingDraftToModel({ ...validDraft, output: '-1' })).toBeNull();
    expect(pricingDraftToModel({ ...validDraft, cacheRead: 'not-a-number' })).toBeNull();
  });
});

describe('dynamic model pricing resolution', () => {
  test('resolves fixed pricing models when expression is missing', () => {
    const fixedModel = {
      provider: 'openai',
      model: 'gpt-4o',
      base_prices: { input: 2.5, output: 10, cache_read: 1.25, cache_write: 0 },
    };
    const resolved = resolveModelDisplayPrices(fixedModel);
    expect(resolved.isDynamic).toBe(false);
    expect(resolved.input).toBe(2.5);
    expect(resolved.output).toBe(10);
    expect(resolved.cacheRead).toBe(1.25);
    expect(resolved.cacheWrite).toBe(0);
    expect(resolved.tiers.length).toBe(0);
  });

  test('resolves single tier dynamic expression (e.g. gpt-5)', () => {
    const dynamicModel = {
      provider: 'codex',
      model: 'gpt-5',
      expression: 'tier("standard", p * 1.25 + cr * 0.125 + c * 10)',
      base_prices: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    };
    const resolved = resolveModelDisplayPrices(dynamicModel);
    expect(resolved.isDynamic).toBe(true);
    expect(resolved.isConditional).toBe(false);
    expect(resolved.input).toBe(1.25);
    expect(resolved.cacheRead).toBe(0.125);
    expect(resolved.output).toBe(10);
    expect(resolved.cacheWrite).toBeNull();
    expect(resolved.tiers.length).toBe(1);
    expect(resolved.tiers[0].name).toBe('standard');
    expect(resolved.tiers[0].input).toBe(1.25);
    expect(resolved.tiers[0].output).toBe(10);
  });

  test('resolves multi-tier conditional expression (e.g. MiniMax-M3 / claude-haiku-5-5)', () => {
    const multiTierModel = {
      provider: 'codex',
      model: 'MiniMax-M3',
      expression:
        'len <= 512000 ? tier("0_512k", p * 0.3 + cr * 0.06 + c * 1.2) : tier("512k_plus", p * 0.6 + cr * 0.12 + c * 2.4)',
      base_prices: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    };
    const resolved = resolveModelDisplayPrices(multiTierModel);
    expect(resolved.isDynamic).toBe(true);
    expect(resolved.isConditional).toBe(true);
    // Primary display defaults to first tier
    expect(resolved.input).toBe(0.3);
    expect(resolved.output).toBe(1.2);
    expect(resolved.cacheRead).toBe(0.06);
    expect(resolved.tiers.length).toBe(2);
    expect(resolved.tiers[0].name).toBe('0_512k');
    expect(resolved.tiers[0].input).toBe(0.3);
    expect(resolved.tiers[1].name).toBe('512k_plus');
    expect(resolved.tiers[1].input).toBe(0.6);
    expect(resolved.tiers[1].output).toBe(2.4);
    expect(resolved.tiers[1].cacheRead).toBe(0.12);
  });

  test('resolves cache write with cc1h/cc12h tokens (e.g. gpt-5.6)', () => {
    const gptModel = {
      provider: 'codex',
      model: 'gpt-5.6',
      expression:
        'len <= 272000 ? tier("0_272k", p * 4 + cr * 0.4 + cc * 5 + cc12h * 10 + c * 20) : tier("272k_plus", p * 8 + cr * 0.8 + cc * 10 + cc12h * 20 + c * 30)',
      base_prices: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    };
    const resolved = resolveModelDisplayPrices(gptModel);
    expect(resolved.isDynamic).toBe(true);
    expect(resolved.input).toBe(4);
    expect(resolved.output).toBe(20);
    expect(resolved.cacheRead).toBe(0.4);
    expect(resolved.cacheWrite).toBe(5);
    expect(resolved.tiers[1].input).toBe(8);
    expect(resolved.tiers[1].output).toBe(30);
    expect(resolved.tiers[1].cacheWrite).toBe(10);
  });
});
