import { describe, expect, it } from "vitest";
import { estimatedCostUsd, pricingForModel } from "./index";

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
});
