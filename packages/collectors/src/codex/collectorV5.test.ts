import { describe, expect, it } from "vitest";
import { createFixturePlatform, type RuntimePlatform } from "@lw-aiusage/platform";
import { CodexCollectorV5 } from "./collectorV5";

const source = [
  JSON.stringify({ type: "session_meta", payload: { id: "session-a", cwd: "/repo" } }),
  JSON.stringify({ type: "token_count", timestamp: 100, payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 12, output_tokens: 3 } } } }),
].join("\n") + "\n";

describe("Codex V5 source collector", () => {
  it("uses raw session identity and creates complete V5 cursors", async () => {
    const platform = createFixturePlatform({ "/fixture/.codex/sessions/a.jsonl": source });
    const collector = new CodexCollectorV5();
    const files = await collector.discoverFiles({ platform, cursors: [{ key: "codex:/fixture/.codex/sessions/a.jsonl", source: "codex", path: "/fixture/.codex/sessions/a.jsonl", logicalId: "stale", offset: 0, size: 0, modifiedAt: 0, pendingText: "", parserVersion: 4 }] });
    const result = await collector.scanSource({ platform, files, cursors: [] });

    expect(files[0]?.logicalId).toBe("session-a");
    expect(result.safeToCommit).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.usage.inputTokens).toBe(12);
    expect(result.cursors).toEqual([expect.objectContaining({ parserVersion: 5, offset: files[0]!.size, pendingText: "", logicalId: "session-a" })]);
    expect(result.cursors[0]).not.toHaveProperty("parserState");
  });

  it("does not use a historical cursor to invent a missing raw session identity", async () => {
    const platform = createFixturePlatform({ "/fixture/.codex/sessions/no-meta.jsonl": JSON.stringify({ type: "token_count", timestamp: 100, payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 1 } } } }) + "\n" });
    const collector = new CodexCollectorV5();
    const files = await collector.discoverFiles({ platform, cursors: [{ key: "codex:/fixture/.codex/sessions/no-meta.jsonl", source: "codex", path: "/fixture/.codex/sessions/no-meta.jsonl", logicalId: "historical", offset: 0, size: 0, modifiedAt: 0, pendingText: "", parserVersion: 4 }] });

    expect(files[0]?.logicalId).toBeUndefined();
  });

  it("rejects a source that changes after parsing", async () => {
    const base = createFixturePlatform({ "/fixture/.codex/sessions/a.jsonl": source });
    let listCalls = 0;
    const fileSystem = Object.create(base.fs) as RuntimePlatform["fs"];
    fileSystem.list = async (path: string) => {
      const entries = await base.fs.list(path);
      if (path === "/fixture/.codex/sessions") {
        listCalls += 1;
        if (listCalls >= 2) return entries.map((entry) => ({ ...entry, modifiedAt: 2 }));
      }
      return entries;
    };
    const platform: RuntimePlatform = { ...base, fs: fileSystem };
    const collector = new CodexCollectorV5();
    const files = await collector.discoverFiles({ platform });
    const result = await collector.scanSource({ platform, files, cursors: [] });

    expect(result.safeToCommit).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.cursors).toEqual([]);
    expect(result.diagnostics).toContain("CODEX_V5_SOURCE_CHANGED_DURING_SCAN");
  });
});
