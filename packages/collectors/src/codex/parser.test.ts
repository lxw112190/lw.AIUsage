import { describe, expect, it } from "vitest";
import { parseCodexEvent } from "./parser";
import { parseJsonl } from "../shared/jsonl";

describe("Codex parser", () => {
  it("normalizes token usage without retaining content", () => {
    const result = parseCodexEvent(
      {
        type: "token_count",
        timestamp: "2026-09-04T08:00:00Z",
        payload: {
          model: "gpt-5-codex",
          cwd: "demo",
          usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 5 },
        },
        secret_prompt: "never persist",
      },
      { projectKey: "unknown" },
      "fixture",
      1,
    );
    expect(result.record?.usage).toEqual({
      inputTokens: 8,
      cachedInputTokens: 2,
      cacheCreationInputTokens: 0,
      outputTokens: 5,
      reasoningOutputTokens: 0,
    });
    expect(result.record).not.toHaveProperty("secret_prompt");
  });
  it("reads nested Codex usage and separates cached and reasoning tokens", () => {
    const result = parseCodexEvent(
      {
        type: "event_msg",
        timestamp: "2026-09-04T08:00:00Z",
        payload: {
          model: "gpt-5-codex",
          info: {
            last_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 30,
              cache_write_input_tokens: 5,
              output_tokens: 60,
              reasoning_output_tokens: 10,
            },
          },
        },
      },
      { projectKey: "unknown" },
      "fixture",
      1,
    );
    expect(result.record?.usage).toEqual({
      inputTokens: 70,
      cachedInputTokens: 30,
      cacheCreationInputTokens: 5,
      outputTokens: 50,
      reasoningOutputTokens: 10,
    });
  });
  it("converts cumulative Codex totals into deltas", () => {
    const first = parseCodexEvent(
      {
        payload: {
          model: "gpt-5-codex",
          info: { total_token_usage: { input_tokens: 1000 } },
        },
      },
      { projectKey: "demo" },
      "fixture",
      1,
    );
    const second = parseCodexEvent(
      { payload: { info: { total_token_usage: { input_tokens: 1800 } } } },
      first.state,
      "fixture",
      2,
    );
    const third = parseCodexEvent(
      { payload: { info: { total_token_usage: { input_tokens: 2500 } } } },
      second.state,
      "fixture",
      3,
    );
    expect(first.record?.usage.inputTokens).toBe(1000);
    expect(second.record?.usage.inputTokens).toBe(800);
    expect(third.record?.usage.inputTokens).toBe(700);
  });
  it("keeps an incomplete final line for the next range", () => {
    const result = parseJsonl<{ type: string }>(
      `{"type":"complete"}\n{"type":"partial"`,
      "",
    );
    expect(result.values).toHaveLength(1);
    expect(result.pendingText).toContain("partial");
  });
});
