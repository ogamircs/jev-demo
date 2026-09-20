import { readFileSync } from 'node:fs';

export const pricing = JSON.parse(readFileSync(new URL('../config/pricing.json', import.meta.url), 'utf8'));

/** Cost of one call in USD from measured token usage and list prices. Returns null if the model has no price entry. */
export function costUsd(model, usage, table = pricing) {
  const e = table.entries[model];
  if (!e || !usage) return null;
  const cached = usage.cached_tokens ?? 0;
  const fresh = Math.max(0, (usage.input_tokens ?? 0) - cached);
  return (fresh * e.inputPerM + cached * e.cachedInputPerM + (usage.output_tokens ?? 0) * e.outputPerM) / 1e6;
}
