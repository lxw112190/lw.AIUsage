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
    expect(result.cursors[0]?.scanRevision).toBe(1);
    expect(result.cursors[0]).not.toHaveProperty("parserState");
  });

  it("blocks an unresolved semantic duplicate and returns no snapshot", async () => {
    const unresolved = [
      JSON.stringify({ type: "session_meta", payload: { id: "session-a" }, timestamp: 90 }),
      JSON.stringify({ type: "token_count", timestamp: 100, payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 100 }, total_token_usage: { input_tokens: 100, output_tokens: 0, total_tokens: 100 } } } }),
      JSON.stringify({ type: "token_count", timestamp: 110, payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 70 }, total_token_usage: { input_tokens: 180, output_tokens: 0, total_tokens: 180 } } } }),
      JSON.stringify({ type: "token_count", timestamp: 110, payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 60 }, total_token_usage: { input_tokens: 180, output_tokens: 0, total_tokens: 180 } } } }),
    ].join("\n") + "\n";
    const platform = createFixturePlatform({ "/fixture/.codex/sessions/a.jsonl": unresolved });
    const collector = new CodexCollectorV5();
    const files = await collector.discoverFiles({ platform });
    const result = await collector.scanSource({ platform, files, cursors: [] });

    expect(result.safeToCommit).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.cursors).toEqual([]);
    expect(result.diagnostics).toContain("CODEX_V5_UNRESOLVED_SEMANTIC_DUPLICATES:1");
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

  it("keeps both physical cursors while deduplicating an exact duplicate source", async () => {
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/a.jsonl": source,
      "/fixture/.codex/archived_sessions/a.jsonl": source,
    });
    const collector = new CodexCollectorV5();
    const files = await collector.discoverFiles({ platform });
    const result = await collector.scanSource({ platform, files, cursors: [] });

    expect(result.safeToCommit).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.cursors).toHaveLength(2);
    expect(new Set(result.cursors.map((cursor) => cursor.path)).size).toBe(2);
  });

  it("keeps the longer file for a strict prefix duplicate", async () => {
    const first = JSON.stringify({ type: "session_meta", payload: { id: "session-a", cwd: "/repo" } });
    const short = `${first}\n${JSON.stringify({ type: "token_count", timestamp: 100, payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 12, output_tokens: 3 } } } })}\n`;
    const longer = `${short}${JSON.stringify({ type: "token_count", timestamp: 110, payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 4, output_tokens: 1 } } } })}\n`;
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/a.jsonl": short,
      "/fixture/.codex/archived_sessions/a.jsonl": longer,
    });
    const collector = new CodexCollectorV5();
    const files = await collector.discoverFiles({ platform });
    const result = await collector.scanSource({ platform, files, cursors: [] });

    expect(result.safeToCommit).toBe(true);
    expect(result.records).toHaveLength(2);
    expect(result.cursors).toHaveLength(2);
  });

  it("blocks divergent logical session files instead of shadowing one", async () => {
    const divergent = source.replace('"input_tokens":12', '"input_tokens":13');
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/a.jsonl": source,
      "/fixture/.codex/archived_sessions/a.jsonl": divergent,
    });
    const collector = new CodexCollectorV5();
    const files = await collector.discoverFiles({ platform });
    const result = await collector.scanSource({ platform, files, cursors: [] });

    expect(result.safeToCommit).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.diagnostics).toContain("CODEX_V5_LOGICAL_CONFLICTS:1");
  });

  it("blocks a pending final JSONL line", async () => {
    const pending = `${JSON.stringify({ type: "session_meta", payload: { id: "session-a", cwd: "/repo" } })}\n${JSON.stringify({ type: "token_count", timestamp: 100, payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 12 } } } }).slice(0, -3)}`;
    const platform = createFixturePlatform({ "/fixture/.codex/sessions/a.jsonl": pending });
    const collector = new CodexCollectorV5();
    const files = await collector.discoverFiles({ platform });
    const result = await collector.scanSource({ platform, files, cursors: [] });

    expect(result.safeToCommit).toBe(false);
    expect(result.diagnostics).toContain("CODEX_V5_PENDING_FILES:1");
  });
});
