import type { TokenUsage } from "./models";

export interface TokenMetricSet {
  current: number;
  withoutCached: number;
  withoutCacheCreation: number;
  withoutReasoning: number;
  withoutAllCache: number;
  plainInputOutput: number;
  rawIoEquivalent: number;
}

export function tokenMetricSet(usage: TokenUsage): TokenMetricSet {
  const {
    inputTokens: input,
    cachedInputTokens: cached,
    cacheCreationInputTokens: creation,
    outputTokens: output,
    reasoningOutputTokens: reasoning,
  } = usage;
  return {
    current: input + cached + creation + output + reasoning,
    withoutCached: input + creation + output + reasoning,
    withoutCacheCreation: input + cached + output + reasoning,
    withoutReasoning: input + cached + creation + output,
    withoutAllCache: input + output + reasoning,
    plainInputOutput: input + output,
    rawIoEquivalent: input + cached + output + reasoning,
  };
}
