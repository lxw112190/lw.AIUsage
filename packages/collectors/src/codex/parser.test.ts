import { describe, expect, it } from "vitest";
import { parseCodexEvent } from "./parser";
import { parseJsonl } from "../shared/jsonl";

describe("Codex parser", () => {
  it("normalizes token usage without retaining content", () => {
    const result = parseCodexEvent({ type: "token_count", timestamp: "2026-09-04T08:00:00Z", payload: { model: "gpt-5-codex", cwd: "demo", usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 5 } }, secret_prompt: "never persist" }, { projectKey: "unknown" }, "fixture", 1);
    expect(result.record?.usage).toEqual({ inputTokens: 10, cachedInputTokens: 2, cacheCreationInputTokens: 0, outputTokens: 5, reasoningOutputTokens: 0 });
    expect(result.record).not.toHaveProperty("secret_prompt");
  });
  it("keeps an incomplete final line for the next range", () => {
    const result = parseJsonl<{ type: string }>(`{"type":"complete"}\n{"type":"partial"`, "");
    expect(result.values).toHaveLength(1); expect(result.pendingText).toContain("partial");
  });
});
