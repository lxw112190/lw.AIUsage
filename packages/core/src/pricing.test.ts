import { describe, expect, it } from "vitest";
import { estimatedCostUsd, pricingForModel, resolvePricing } from "./index";

describe("pricing", () => {
  it("estimates cached and output tokens with the model catalog", () => {
    const pricing = pricingForModel("gpt-5-codex");
    expect(pricing).toBeDefined();
    expect(
      estimatedCostUsd(
        {
          inputTokens: 1_000_000,
          cachedInputTokens: 1_000_000,
          cacheCreationInputTokens: 0,
          outputTokens: 1_000_000,
          reasoningOutputTokens: 0,
        },
        pricing!,
      ),
    ).toBe(11.375);
  });

  it.each([
    ["gpt-5.4", "exact"],
    ["gpt_5.4_codex", "alias"],
    ["gpt-5-codex", "family-fallback"],
    ["brand-new-model", "unmatched"],
  ] as const)("resolves %s as %s", (model, kind) => {
    expect(resolvePricing(model).kind).toBe(kind);
  });

  it("prefers a specific exact model over a broader family", () => {
    expect(resolvePricing("gpt-5.4").entry?.label).toBe("GPT-5.4");
  });
});
