import { describe, expect, it } from "vitest";
import { createFixturePlatform } from "@lw-aiusage/platform";
import { ClaudeCollector } from "./collector";
import type { ClaudeParserState } from "./types";

describe("Claude collector", () => {
  it("does not inherit seenUsage during a full rescan", async () => {
    const platform = createFixturePlatform({ "/fixture/.claude/projects/demo/session.jsonl": '{"requestId":"r1","message":{"id":"m1","model":"claude-sonnet-4","usage":{"input_tokens":100,"output_tokens":10}}}\n' });
    const collector = new ClaudeCollector();
    const file = (await collector.discoverFiles({ platform }))[0]!;
    const parserState: ClaudeParserState = { projectKey: "demo", seenUsage: { "m1:r1": { inputTokens: 50, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 5, reasoningOutputTokens: 0 } } };
    const result = await collector.scanFile({ platform, file, cursor: { key: "claude:" + file.path, source: "claude", path: file.path, offset: file.size, size: file.size, modifiedAt: file.modifiedAt, pendingText: "", parserVersion: 2, parserState } });
    expect(result.records[0]?.usage.inputTokens).toBe(100);
  });
});
