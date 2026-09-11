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

  it("prefers the longest matching family independently of catalog order", () => {
    const catalog = [
      { id: "broad", match: "gpt-5", label: "Broad", source: "openai" as const, familyFallbacks: ["gpt-5"], inputPerMillion: 1, cachedInputPerMillion: 1, outputPerMillion: 1 },
      { id: "specific", match: "gpt-5.4", label: "Specific", source: "openai" as const, familyFallbacks: ["gpt-5.4"], inputPerMillion: 1, cachedInputPerMillion: 1, outputPerMillion: 1 },
    ];
    expect(resolvePricing("gpt-5.4-codex-new", catalog).entry?.id).toBe("specific");
    expect(resolvePricing("gpt-5.4-codex-new", [...catalog].reverse()).entry?.id).toBe("specific");
  });
});
