import { apiClient } from './client';

export interface UsageAggregate {
  requests: number;
  success: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  reported_cost_usd_micros: number;
  estimated_cost_usd_micros: number;
  effective_cost_usd_micros: number;
  latency_total_ms: number;
  ttft_total_ms: number;
}

export interface UsageDay extends UsageAggregate {
  date: string;
}

export interface UsageSummary {
  from: string;
  to: string;
  timezone: string;
  totals: UsageAggregate;
  days: UsageDay[];
}

export interface UsageEvent {
  sequence: number;
  timestamp: string;
  request_id?: string;
  trace_id?: string;
  provider: string;
  executor_type?: string;
  model: string;
  alias?: string;
  access_provider?: string;
  api_key_fingerprint?: string;
  auth_id?: string;
  auth_index?: string;
  auth_type?: string;
  source?: string;
  failure_code?: string;
  service_tier?: string;
  response_model?: string;
  failed: boolean;
  failure_status_code?: number;
  latency_ms: number;
  ttft_ms: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  reported_cost_usd_micros: number;
  estimated_cost_usd_micros: number;
  effective_cost_usd_micros: number;
  pricing_revision?: number;
  cost_source?: string;
}

export interface UsageEventsPage {
  items: UsageEvent[];
  next_before?: number;
}

export interface PricingModel {
  provider: string;
  model: string;
  expression?: string;
  source?: string;
  base_prices: {
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
  };
}

export interface PricingCatalog {
  revision: number;
  models: PricingModel[];
}

export interface PricingSyncResponse extends PricingCatalog {
  sync: {
    source: string;
    configured_models: number;
    matched: number;
    updated: number;
    unmatched: Array<{ provider: string; model: string }>;
  };
}

export const usageHistoryApi = {
  getSummary: (from: string, to: string) =>
    apiClient.get<UsageSummary>('/observability/usage/summary', { params: { from, to } }),
  getEvents: (before?: number, limit = 50) =>
    apiClient.get<UsageEventsPage>('/observability/usage/events', {
      params: { limit, ...(before ? { before } : {}) },
    }),
  getPricingModels: () => apiClient.get<PricingCatalog>('/observability/pricing/models'),
  syncPricingModels: (revision: number) =>
    apiClient.post<PricingSyncResponse>('/observability/pricing/models/sync', { revision }),
  putPricingModel: (revision: number, model: PricingModel) =>
    apiClient.put<PricingCatalog>('/observability/pricing/models', { revision, ...model }),
  deletePricingModel: (revision: number, provider: string, model: string) =>
    apiClient.delete<PricingCatalog>('/observability/pricing/models', {
      params: { revision, provider, model },
    }),
};
