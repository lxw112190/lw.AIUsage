import type { ModelPricing } from "./aggregate";

export type PricingMatchKind = "exact" | "alias" | "family-fallback" | "unmatched";

export interface PricingEntry extends ModelPricing {
  id: string;
  /** Kept for compatibility with older callers and custom catalogs. */
  match: string;
  label: string;
  source: "openai" | "anthropic";
  exactModels?: readonly string[];
  aliases?: readonly string[];
  familyFallbacks?: readonly string[];
  effectiveFrom?: string;
  note?: string;
}

export interface PricingResolution {
  rawModel: string;
  normalizedModel: string;
  kind: PricingMatchKind;
  entry?: PricingEntry;
  estimated: boolean;
}

// Defaults are API-equivalent estimates, not subscription invoices. Keep this table replaceable.
export const defaultPricing: readonly PricingEntry[] = [
  {
    id: "openai-gpt-5.4",
    match: "gpt-5.4",
    label: "GPT-5.4",
    source: "openai",
    exactModels: ["gpt-5.4"],
    aliases: ["gpt-5.4-codex"],
    familyFallbacks: ["gpt-5.4"],
    inputPerMillion: 2.5,
    cachedInputPerMillion: 0.25,
    outputPerMillion: 15,
  },
  {
    id: "openai-gpt-5",
    match: "gpt-5",
    label: "GPT-5",
    source: "openai",
    exactModels: ["gpt-5"],
    familyFallbacks: ["gpt-5"],
    inputPerMillion: 1.25,
    cachedInputPerMillion: 0.125,
    outputPerMillion: 10,
  },
  {
    id: "anthropic-claude-opus-4",
    match: "claude-opus-4",
    label: "Claude Opus 4",
    source: "anthropic",
    exactModels: ["claude-opus-4"],
    familyFallbacks: ["claude-opus-4"],
    inputPerMillion: 15,
    cachedInputPerMillion: 1.5,
    cacheCreationPerMillion: 18.75,
    outputPerMillion: 75,
  },
  {
    id: "anthropic-claude-sonnet-4",
    match: "claude-sonnet-4",
    label: "Claude Sonnet 4",
    source: "anthropic",
    exactModels: ["claude-sonnet-4"],
    familyFallbacks: ["claude-sonnet-4"],
    inputPerMillion: 3,
    cachedInputPerMillion: 0.3,
    cacheCreationPerMillion: 3.75,
    outputPerMillion: 15,
  },
  {
    id: "anthropic-claude-haiku-3.5",
    match: "claude-haiku-3.5",
    label: "Claude Haiku 3.5",
    source: "anthropic",
    exactModels: ["claude-haiku-3.5"],
    familyFallbacks: ["claude-haiku-3.5"],
    inputPerMillion: 0.8,
    cachedInputPerMillion: 0.08,
    cacheCreationPerMillion: 1,
    outputPerMillion: 4,
  },
];

export function normalizePricingModel(rawModel: string): string {
  return rawModel.trim().toLowerCase().replace(/[ _]+/g, "-").replace(/-+/g, "-");
}

const includesFamily = (model: string, family: string): boolean => model === family || model.startsWith(`${family}-`) || model.includes(`${family}-`);

export function resolvePricing(
  rawModel: string,
  pricing: readonly PricingEntry[] = defaultPricing,
): PricingResolution {
  const normalizedModel = normalizePricingModel(rawModel);
  const exact = pricing.find((entry) => (entry.exactModels ?? [entry.match]).some((model) => normalizePricingModel(model) === normalizedModel));
  if (exact) return { rawModel, normalizedModel, kind: "exact", entry: exact, estimated: false };
  const alias = pricing.find((entry) => (entry.aliases ?? []).some((model) => normalizePricingModel(model) === normalizedModel));
  if (alias) return { rawModel, normalizedModel, kind: "alias", entry: alias, estimated: true };
  const families: Array<{ entry: PricingEntry; family: string }> = [];
  for (const entry of pricing) {
    for (const rawFamily of entry.familyFallbacks ?? [entry.match]) {
      const family = normalizePricingModel(rawFamily);
      if (includesFamily(normalizedModel, family)) families.push({ entry, family });
    }
  }
  families.sort((left, right) =>
    right.family.length - left.family.length || left.entry.id.localeCompare(right.entry.id));
  const family = families[0]?.entry;
  if (family) return { rawModel, normalizedModel, kind: "family-fallback", entry: family, estimated: true };
  return { rawModel, normalizedModel, kind: "unmatched", estimated: true };
}

/** Compatibility helper. New code should use resolvePricing when it needs confidence. */
export function pricingForModel(
  rawModel: string,
  pricing: readonly PricingEntry[] = defaultPricing,
): PricingEntry | undefined {
  return resolvePricing(rawModel, pricing).entry;
}
