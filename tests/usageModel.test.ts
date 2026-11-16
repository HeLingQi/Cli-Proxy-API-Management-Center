import { describe, expect, test } from 'bun:test';
import { isUsageDateRangeValid, pricingDraftToModel } from '../src/features/usage/model';

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
