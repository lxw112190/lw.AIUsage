import { describe, expect, it } from "vitest";
import { parseCodexEvent } from "./parser";
import { parseJsonl } from "../shared/jsonl";
import { zeroUsage } from "@lw-aiusage/core";

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
  it("supports payload.msg.info and model changes from info", () => {
    const modelEvent = parseCodexEvent({ type: "turn_context", payload: { info: { model: "gpt-5-codex" } } }, { projectKey: "demo" }, "fixture", 1);
    const usageEvent = parseCodexEvent({ type: "event_msg", payload: { msg: { type: "token_count", info: { last_token_usage: { input_tokens: 10, output_tokens: 5 } } } } }, modelEvent.state, "fixture", 2);
    expect(usageEvent.record?.model).toBe("gpt-5-codex");
    expect(usageEvent.record?.usage.outputTokens).toBe(5);
  });
  it("takes session_meta payload.id and skips a fork replay baseline", () => {
    const meta = parseCodexEvent({ type: "session_meta", payload: { id: "session-1", forked_from_id: "parent" } }, { projectKey: "demo" }, "fixture", 1);
    const first = parseCodexEvent({ payload: { model: "gpt-5-codex", info: { total_token_usage: { input_tokens: 1000 } } } }, { ...meta.state, forkBaselineUsage: { ...zeroUsage(), inputTokens: 1000 } }, "fixture", 2);
    expect(meta.state.sessionId).toBe("session-1");
    expect(first.record).toBeUndefined();
  });
  it("keeps an incomplete final line for the next range", () => {
    const result = parseJsonl<{ type: string }>(
      `{"type":"complete"}\n{"type":"partial"`,
      "",
    );
    expect(result.values).toHaveLength(1);
    expect(result.pendingText).toContain("partial");
  });
  it("keeps a multi-megabyte JSON line across read chunks", () => {
    const line = JSON.stringify({ type: "large", text: "x".repeat(600_000) });
    const splitAt = 300_000;
    const first = parseJsonl<{ type: string; text: string }>(line.slice(0, splitAt), "");
    const second = parseJsonl<{ type: string; text: string }>(`${line.slice(splitAt)}\n`, first.pendingText);

    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
    expect(second.values).toHaveLength(1);
    expect(second.values[0]?.text).toHaveLength(600_000);
  });
});
