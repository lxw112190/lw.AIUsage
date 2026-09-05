import { describe, expect, it } from "vitest";
import { parseClaudeEvent } from "./parser";

describe("Claude Code parser", () => {
  it("maps Anthropic cache usage to the common token model", () => {
    const result = parseClaudeEvent(
      {
        type: "assistant",
        uuid: "u1",
        sessionId: "s1",
        timestamp: "2026-09-05T08:00:00Z",
        cwd: "C:\\work\\demo",
        message: {
          model: "claude-sonnet-4",
          usage: {
            input_tokens: 100,
            cache_read_input_tokens: 20,
            cache_creation_input_tokens: 4,
            output_tokens: 30,
          },
          content: [{ type: "text", text: "must not persist" }],
        },
      },
      { projectKey: "unknown" },
      "fixture",
      0,
    );
    expect(result.record?.source).toBe("claude");
    expect(result.record?.projectKey).toBe("demo");
    expect(result.record?.usage.cachedInputTokens).toBe(20);
    expect(result.record).not.toHaveProperty("message");
  });
  it("uses message.id and requestId to update usage instead of double counting", () => {
    const first = parseClaudeEvent({ uuid: "a", requestId: "r1", message: { id: "m1", model: "claude-sonnet-4", usage: { input_tokens: 100, output_tokens: 10 } } }, { projectKey: "demo" }, "fixture", 0);
    const second = parseClaudeEvent({ uuid: "b", requestId: "r1", message: { id: "m1", model: "claude-sonnet-4", usage: { input_tokens: 180, output_tokens: 20 } } }, first.state, "fixture", 1);
    const duplicate = parseClaudeEvent({ uuid: "c", requestId: "r1", message: { id: "m1", model: "claude-sonnet-4", usage: { input_tokens: 180, output_tokens: 20 } } }, second.state, "fixture", 2);
    expect(second.record?.id).toBe(first.record?.id);
    expect(second.record?.usage.inputTokens).toBe(180);
    expect(duplicate.record).toBeUndefined();
  });
  it("supports ephemeral cache creation fields", () => {
    const result = parseClaudeEvent({ requestId: "r1", message: { id: "m1", model: "claude-sonnet-4", usage: { input_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: 4, ephemeral_1h_input_tokens: 6 }, output_tokens: 1 } } }, { projectKey: "demo" }, "fixture", 0);
    expect(result.record?.usage.cacheCreationInputTokens).toBe(10);
  });
});
