import {
  estimatedCostUsd,
  resolvePricing,
  totalTokens,
  type PricingMatchKind,
  type TokenUsage,
  type UsageBucket,
  type UsageRecord,
} from "@lw-aiusage/core";

export interface PricingModelCoverage {
  model: string;
  totalTokens: number;
  kind: PricingMatchKind;
  pricingLabel?: string;
  estimatedCostUsd?: number;
}

export interface PricingCoverageSummary {
  totalTokens: number;
  exactTokens: number;
  aliasTokens: number;
  fallbackTokens: number;
  unmatchedTokens: number;
  pricedTokens: number;
  coverageRatio: number;
  exactCoverage: number;
  estimatedCostUsd: number;
  models: PricingModelCoverage[];
}

const empty = (): PricingCoverageSummary => ({ totalTokens: 0, exactTokens: 0, aliasTokens: 0, fallbackTokens: 0, unmatchedTokens: 0, pricedTokens: 0, coverageRatio: 0, exactCoverage: 0, estimatedCostUsd: 0, models: [] });

function add(summary: PricingCoverageSummary, model: string, usage: TokenUsage): void {
  const tokens = totalTokens(usage);
  const resolution = resolvePricing(model);
  summary.totalTokens += tokens;
  if (resolution.kind === "exact") summary.exactTokens += tokens;
  else if (resolution.kind === "alias") summary.aliasTokens += tokens;
  else if (resolution.kind === "family-fallback") summary.fallbackTokens += tokens;
  else summary.unmatchedTokens += tokens;
  if (resolution.entry) { summary.pricedTokens += tokens; summary.estimatedCostUsd += estimatedCostUsd(usage, resolution.entry); }
  const current = summary.models.find((item) => item.model === model);
  if (current) { current.totalTokens += tokens; current.estimatedCostUsd = (current.estimatedCostUsd ?? 0) + (resolution.entry ? estimatedCostUsd(usage, resolution.entry) : 0); }
  else summary.models.push({ model, totalTokens: tokens, kind: resolution.kind, ...(resolution.entry ? { pricingLabel: resolution.entry.label, estimatedCostUsd: estimatedCostUsd(usage, resolution.entry) } : {}) });
}

export function pricingCoverageForBuckets(items: readonly UsageBucket[]): PricingCoverageSummary {
  const summary = empty();
  for (const item of items) add(summary, item.model, item.usage);
  return finalize(summary);
}

export function pricingCoverageForRecords(items: readonly UsageRecord[]): PricingCoverageSummary {
  const summary = empty();
  for (const item of items) add(summary, item.model, item.usage);
  return finalize(summary);
}

function finalize(summary: PricingCoverageSummary): PricingCoverageSummary {
  summary.coverageRatio = summary.totalTokens > 0 ? summary.pricedTokens / summary.totalTokens : 0;
  summary.exactCoverage = summary.totalTokens > 0 ? (summary.exactTokens + summary.aliasTokens) / summary.totalTokens : 0;
  summary.models.sort((left, right) => right.totalTokens - left.totalTokens || left.model.localeCompare(right.model));
  return summary;
}
