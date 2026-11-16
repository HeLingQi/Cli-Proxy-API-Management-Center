import type { PricingModel } from '@/services/api/usageHistory';

export type PricingDraft = {
  provider: string;
  model: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
};

export function isUsageDateRangeValid(from: string, to: string): boolean {
  return Boolean(from && to && from <= to);
}

export function pricingDraftToModel(draft: PricingDraft): PricingModel | null {
  const prices = [draft.input, draft.output, draft.cacheRead, draft.cacheWrite].map(Number);
  if (
    !draft.provider.trim() ||
    !draft.model.trim() ||
    prices.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    return null;
  }
  return {
    provider: draft.provider.trim(),
    model: draft.model.trim(),
    base_prices: {
      input: prices[0],
      output: prices[1],
      cache_read: prices[2],
      cache_write: prices[3],
    },
  };
}
