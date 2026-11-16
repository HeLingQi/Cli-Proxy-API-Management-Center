import type { PricingModel } from '@/services/api/usageHistory';

export type PricingDraft = {
  provider: string;
  model: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
};

export type PricingTier = {
  name: string;
  condition?: string;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
};

export type ModelDisplayPrices = {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  isDynamic: boolean;
  isConditional: boolean;
  tiers: PricingTier[];
};

export function isUsageDateRangeValid(from: string, to: string): boolean {
  return Boolean(from && to && from <= to);
}

export function buildUsageDatePreset(days: number, anchorDate = new Date()): { from: string; to: string } {
  const end = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth(), anchorDate.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(0, days - 1));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

function parseTierBody(body: string): {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
} {
  const prices: {
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
  } = {
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
  };

  // Match expressions like: p * 1.25, cr * 0.125, 10 * c, etc.
  const termRegex = /(?:(\d+(?:\.\d+)?)\s*\*\s*([a-zA-Z0-9_]+))|(?:([a-zA-Z0-9_]+)\s*\*\s*(\d+(?:\.\d+)?))/g;
  for (const match of body.matchAll(termRegex)) {
    const rawVal = match[1] || match[4];
    const variable = (match[2] || match[3]) as string;
    const num = Number(rawVal);
    if (!Number.isFinite(num)) continue;

    if (variable === 'p' && prices.input === null) {
      prices.input = num;
    } else if (variable === 'c' && prices.output === null) {
      prices.output = num;
    } else if (variable === 'cr' && prices.cacheRead === null) {
      prices.cacheRead = num;
    } else if ((variable === 'cc' || variable === 'cc1h' || variable === 'cc12h') && prices.cacheWrite === null) {
      prices.cacheWrite = num;
    }
  }

  return prices;
}

export function resolveModelDisplayPrices(model: PricingModel): ModelDisplayPrices {
  const expr = model.expression?.trim() ?? '';
  if (!expr) {
    return {
      input: model.base_prices.input,
      output: model.base_prices.output,
      cacheRead: model.base_prices.cache_read,
      cacheWrite: model.base_prices.cache_write,
      isDynamic: false,
      isConditional: false,
      tiers: [],
    };
  }

  const tiers: PricingTier[] = [];
  const tierRegex = /tier\(\s*"([^"]+)"\s*,\s*([^)]+)\)/g;
  const matches = Array.from(expr.matchAll(tierRegex));

  if (matches.length > 0) {
    for (const match of matches) {
      const tierName = match[1];
      const tierBody = match[2];
      const parsed = parseTierBody(tierBody);
      tiers.push({
        name: tierName,
        input: parsed.input,
        output: parsed.output,
        cacheRead: parsed.cacheRead,
        cacheWrite: parsed.cacheWrite,
      });
    }
  } else {
    const parsed = parseTierBody(expr);
    tiers.push({
      name: 'standard',
      input: parsed.input,
      output: parsed.output,
      cacheRead: parsed.cacheRead,
      cacheWrite: parsed.cacheWrite,
    });
  }

  // Primary rate is the first tier (typically "standard" or lowest tier like "0_100k")
  const primary = tiers[0] || {
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
  };

  return {
    input: primary.input,
    output: primary.output,
    cacheRead: primary.cacheRead,
    cacheWrite: primary.cacheWrite,
    isDynamic: true,
    isConditional: expr.includes('?') || tiers.length > 1,
    tiers,
  };
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
