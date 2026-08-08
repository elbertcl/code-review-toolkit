export interface RateEntry {
  input_per_million?: number;
  output_per_million?: number;
  cache_read_per_million?: number;
}

export interface CostBreakdown {
  input: number;
  output: number;
  cache_read: number;
  total: number;
}

export function computeCost(
  tokens: { input_tokens?: number; output_tokens?: number; cache_read_tokens?: number },
  rates: Record<string, RateEntry> | undefined | null,
  model: string | undefined,
): CostBreakdown | null {
  if (!rates || typeof rates !== "object") return null;
  if (!model || !(model in rates)) return null;

  const entry = rates[model];

  const inCost = ((tokens.input_tokens ?? 0) / 1_000_000) * (entry.input_per_million ?? 0);
  const outCost = ((tokens.output_tokens ?? 0) / 1_000_000) * (entry.output_per_million ?? 0);
  const cacheCost = ((tokens.cache_read_tokens ?? 0) / 1_000_000) * (entry.cache_read_per_million ?? 0);

  return {
    input: Math.round(inCost * 10000) / 10000,
    output: Math.round(outCost * 10000) / 10000,
    cache_read: Math.round(cacheCost * 10000) / 10000,
    total: Math.round((inCost + outCost + cacheCost) * 10000) / 10000,
  };
}
