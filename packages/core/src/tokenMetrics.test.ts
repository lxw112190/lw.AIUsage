import { describe, expect, it } from "vitest";
import { tokenMetricSet } from "./tokenMetrics";

describe("token metrics", () => {
  it("calculates the comparison accounting modes", () => {
    const metrics = tokenMetricSet({
      inputTokens: 10,
      cachedInputTokens: 20,
      cacheCreationInputTokens: 30,
      outputTokens: 40,
      reasoningOutputTokens: 50,
    });
    expect(metrics).toEqual({
      current: 150,
      withoutCached: 130,
      withoutCacheCreation: 120,
      withoutReasoning: 100,
      withoutAllCache: 100,
      plainInputOutput: 50,
      rawIoEquivalent: 120,
    });
  });
});
