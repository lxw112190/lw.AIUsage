import { describe, expect, it } from "vitest";
import type { CollectorFile } from "@lw-aiusage/collectors";
import { MemoryUsageRepository, type FileCursor } from "@lw-aiusage/storage";
import { reconcileCollectorFiles } from "./sessionReconcile";

const file = (path: string, size: number, modifiedAt: number): CollectorFile => ({ path, name: path.split(/[\\/]/).at(-1) ?? "session.jsonl", isFile: true, isDirectory: false, size, modifiedAt, source: "codex", logicalId: "S1" });
const cursor = (path: string): FileCursor => ({ key: `codex:${path}`, source: "codex", path, logicalId: "S1", offset: 100, size: 100, modifiedAt: 1, pendingText: "", parserVersion: 3, parserState: { sessionId: "S1", projectKey: "demo" } });

describe("session file reconciliation", () => {
  it("migrates a moved session before scanning the new path", async () => {
    const repository = new MemoryUsageRepository();
    const old = cursor("/fixture/.codex/sessions/a.jsonl");
    await repository.commitScan([{ id: "codex:event", source: "codex", sourcePath: old.path, sessionId: "S1", timestamp: 1, model: "gpt-5", projectKey: "demo", usage: { inputTokens: 100, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 } }], old);
    const moved = file("/fixture/.codex/archived_sessions/a.jsonl", 100, 2);
    const [result] = await reconcileCollectorFiles(repository, "codex", [moved], [old]);
    expect(result?.migrated).toBe(true);
    expect(result?.cursor?.path).toBe(moved.path);
    expect((await repository.getRecords())[0]?.sourcePath).toBe(moved.path);
    expect((await repository.getCursors())[0]?.path).toBe(moved.path);
  });

  it("keeps only the preferred file when a session exists at two paths", async () => {
    const repository = new MemoryUsageRepository();
    const older = file("/fixture/.codex/sessions/a.jsonl", 100, 1);
    const archived = file("/fixture/.codex/archived_sessions/a.jsonl", 200, 1);
    const results = await reconcileCollectorFiles(repository, "codex", [older, archived], []);
    expect(results.find((item) => item.file.path === older.path)?.shadowDuplicate).toBe(true);
    expect(results.find((item) => item.file.path === archived.path)?.shadowDuplicate).toBeUndefined();
  });

  it("keeps multiple Claude files for the same session", async () => {
    const repository = new MemoryUsageRepository();
    const first = { ...file("/fixture/.claude/projects/p/main.jsonl", 100, 1), source: "claude" as const };
    const subagent = { ...file("/fixture/.claude/projects/p/subagents/a.jsonl", 200, 2), source: "claude" as const };
    const results = await reconcileCollectorFiles(repository, "claude", "path", [first, subagent], []);
    expect(results).toHaveLength(2);
    expect(results.every((item) => !item.shadowDuplicate)).toBe(true);
  });
});
