import { describe, expect, it } from "vitest";
import { parseClaudeEvent } from "./parser";

describe("Claude Code parser", () => {
  it("maps Anthropic cache usage to the common token model", () => {
    const result = parseClaudeEvent({ type: "assistant", uuid: "u1", sessionId: "s1", timestamp: "2026-09-05T08:00:00Z", cwd: "C:\\work\\demo", message: { model: "claude-sonnet-4", usage: { input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 4, output_tokens: 30 }, content: [{ type: "text", text: "must not persist" }] } }, { projectKey: "unknown" }, "fixture", 0);
    expect(result.record?.source).toBe("claude"); expect(result.record?.projectKey).toBe("demo"); expect(result.record?.usage.cachedInputTokens).toBe(20); expect(result.record).not.toHaveProperty("message");
  });
});
