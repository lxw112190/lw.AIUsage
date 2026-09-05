import { describe, expect, it } from "vitest";
import { createFixturePlatform } from "@lw-aiusage/platform";
import { CodexCollector } from "./collector";

describe("Codex collector", () => {
  it("discovers and scans a fixture incrementally", async () => {
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/demo.jsonl":
        '{"type":"session_meta","payload":{"session_id":"s1","cwd":"demo"}}\n{"type":"turn_context","payload":{"model":"gpt-5-codex"}}\n{"type":"token_count","timestamp":1725436920000,"payload":{"usage":{"input_tokens":10,"output_tokens":5}}}\n',
    });
    const collector = new CodexCollector();
    const files = await collector.discoverFiles({ platform });
    expect(files).toHaveLength(1);
    const result = await collector.scanFile({ platform, file: files[0]! });
    expect(result.records[0]?.projectKey).toBe("demo");
    expect(result.records[0]?.sessionId).toBe("s1");
    expect(result.records[0]?.usage.outputTokens).toBe(5);
    const second = await collector.scanFile({
      platform,
      file: files[0]!,
      cursor: result.cursor,
    });
    expect(second.records).toHaveLength(0);
  });
  it("does not inherit stale totals during a full rescan", async () => {
    const platform = createFixturePlatform({ "/fixture/.codex/sessions/demo.jsonl": '{"type":"turn_context","payload":{"model":"gpt-5-codex"}}\n{"payload":{"info":{"total_token_usage":{"input_tokens":1000}}}}\n' });
    const collector = new CodexCollector();
    const file = (await collector.discoverFiles({ platform }))[0]!;
    const result = await collector.scanFile({ platform, file, cursor: { key: "codex:" + file.path, source: "codex", path: file.path, offset: file.size, size: file.size, modifiedAt: file.modifiedAt, pendingText: "", parserVersion: 2, parserState: { projectKey: "demo", previousTotalUsage: { inputTokens: 50000, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 } } } });
    expect(result.records[0]?.usage.inputTokens).toBe(1000);
  });
  it("subtracts the parent baseline from a child fork replay", async () => {
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/01-parent.jsonl": '{"type":"session_meta","payload":{"id":"parent","cwd":"demo"}}\n{"payload":{"model":"gpt-5-codex","info":{"total_token_usage":{"input_tokens":1000}}}}\n',
      "/fixture/.codex/sessions/02-child.jsonl": '{"type":"session_meta","payload":{"id":"child","forked_from_id":"parent","cwd":"demo"}}\n{"payload":{"model":"gpt-5-codex","info":{"total_token_usage":{"input_tokens":1000}}}}\n{"payload":{"info":{"total_token_usage":{"input_tokens":1200}}}}\n',
    });
    const collector = new CodexCollector();
    const files = await collector.discoverFiles({ platform });
    const parent = await collector.scanFile({ platform, file: files[0]! });
    const restartedCollector = new CodexCollector();
    const restartedFiles = await restartedCollector.discoverFiles({ platform, cursors: [parent.cursor] });
    const child = await restartedCollector.scanFile({ platform, file: restartedFiles[1]! });
    expect(child.records).toHaveLength(1);
    expect(child.records[0]?.usage.inputTokens).toBe(200);
  });
});
