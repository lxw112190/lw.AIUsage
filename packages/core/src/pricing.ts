import type { ModelPricing } from "./aggregate";

export interface PricingEntry extends ModelPricing {
  match: string;
  label: string;
  source: "openai" | "anthropic";
}

// Defaults are API-equivalent estimates, not subscription invoices. Keep this table replaceable.
export const defaultPricing: readonly PricingEntry[] = [
  {
    match: "gpt-5.4",
    label: "GPT-5.4",
    source: "openai",
    inputPerMillion: 2.5,
    cachedInputPerMillion: 0.25,
    outputPerMillion: 15,
  },
  {
    match: "gpt-5",
    label: "GPT-5",
    source: "openai",
    inputPerMillion: 1.25,
    cachedInputPerMillion: 0.125,
    outputPerMillion: 10,
  },
  {
    match: "claude-opus-4",
    label: "Claude Opus 4",
    source: "anthropic",
    inputPerMillion: 15,
    cachedInputPerMillion: 1.5,
    cacheCreationPerMillion: 18.75,
    outputPerMillion: 75,
  },
  {
    match: "claude-sonnet-4",
    label: "Claude Sonnet 4",
    source: "anthropic",
    inputPerMillion: 3,
    cachedInputPerMillion: 0.3,
    cacheCreationPerMillion: 3.75,
    outputPerMillion: 15,
  },
  {
    match: "claude-haiku-3.5",
    label: "Claude Haiku 3.5",
    source: "anthropic",
    inputPerMillion: 0.8,
    cachedInputPerMillion: 0.08,
    cacheCreationPerMillion: 1,
    outputPerMillion: 4,
  },
];

export function pricingForModel(
  rawModel: string,
  pricing: readonly PricingEntry[] = defaultPricing,
): PricingEntry | undefined {
  const normalized = rawModel.toLowerCase().replace(/[_ ]/g, "-");
  return pricing.find((entry) => normalized.includes(entry.match));
}
