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
});
