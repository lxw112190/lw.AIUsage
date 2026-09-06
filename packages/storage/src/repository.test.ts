import { describe, expect, it } from "vitest";
import { MemoryUsageRepository, type FileCursor } from "./repository";

describe("repository pagination", () => {
  it("paginates in stable descending timestamp and id order", async () => {
    const repository = new MemoryUsageRepository();
    const usage = { inputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
    await repository.putRecords([
      { id: "b", source: "codex", timestamp: 2, model: "gpt-5", projectKey: "p", usage },
      { id: "a", source: "codex", timestamp: 2, model: "gpt-5", projectKey: "p", usage },
      { id: "c", source: "claude", timestamp: 1, model: "claude-sonnet-4", projectKey: "q", usage },
    ]);
    const first = await repository.getRecordsPage({ page: 1, pageSize: 2 });
    const second = await repository.getRecordsPage({ page: 2, pageSize: 2 });
    expect(first.items.map((record) => record.id)).toEqual(["b", "a"]);
    expect(second.items.map((record) => record.id)).toEqual(["c"]);
    expect(first.total).toBe(3);
  });
  it("applies source, model, project and half-open date filters", async () => {
    const repository = new MemoryUsageRepository();
    const usage = { inputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
    await repository.putRecords([
      { id: "a", source: "codex", timestamp: 100, model: "gpt-5", projectKey: "p", usage },
      { id: "b", source: "codex", timestamp: 200, model: "gpt-5", projectKey: "p", usage },
      { id: "c", source: "claude", timestamp: 200, model: "gpt-5", projectKey: "p", usage },
    ]);
    const result = await repository.getRecordsPage({ page: 1, pageSize: 20, source: "codex", model: "gpt-5", projectKey: "p", from: 100, to: 200 });
    expect(result.items.map((record) => record.id)).toEqual(["a"]);
  });
  it("summarizes one source without mixing other agents", async () => {
    const repository = new MemoryUsageRepository();
    const usage = { inputTokens: 2, cachedInputTokens: 1, cacheCreationInputTokens: 0, outputTokens: 3, reasoningOutputTokens: 0 };
    await repository.putRecords([
      { id: "a", source: "codex", sessionId: "s1", timestamp: 1, model: "gpt-5", projectKey: "p", usage },
      { id: "b", source: "codex", sessionId: "s1", timestamp: 2, model: "gpt-5", projectKey: "p", usage },
      { id: "c", source: "claude", sessionId: "s2", timestamp: 3, model: "claude", projectKey: "p", usage },
    ]);
    const summary = await repository.getSourceUsageSummary("codex");
    expect(summary.recordCount).toBe(2);
    expect(summary.sessionCount).toBe(1);
    expect(summary.totalTokens).toBe(12);
  });
});

describe("repository scan commit", () => {
  it("is safe to repeat after a retry", async () => {
    const repository = new MemoryUsageRepository();
    const record = {
      id: "r1",
      source: "codex" as const,
      timestamp: 1,
      model: "gpt-5",
      projectKey: "demo",
      usage: {
        inputTokens: 1,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 1,
        reasoningOutputTokens: 0,
      },
    };
    const cursor: FileCursor = {
      key: "codex:file",
      source: "codex",
      path: "file",
      offset: 10,
      size: 10,
      modifiedAt: 1,
      pendingText: "",
      parserVersion: 1,
    };
    expect(await repository.commitScan([record], cursor)).toBe(1);
    expect(await repository.commitScan([record], cursor)).toBe(0);
    expect(await repository.getRecords()).toHaveLength(1);
    expect((await repository.getCursors())[0]?.offset).toBe(10);
  });
  it("updates a record when a stable event receives newer usage", async () => {
    const repository = new MemoryUsageRepository();
    const cursor: FileCursor = {
      key: "claude:file",
      source: "claude",
      path: "file",
      offset: 10,
      size: 10,
      modifiedAt: 1,
      pendingText: "",
      parserVersion: 2,
    };
    const base = {
      id: "claude:event-1",
      source: "claude" as const,
      sourcePath: "file",
      timestamp: 1,
      model: "claude-sonnet-4",
      projectKey: "demo",
      usage: {
        inputTokens: 1,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 1,
        reasoningOutputTokens: 0,
      },
    };
    const updated = { ...base, usage: { ...base.usage, outputTokens: 4 } };
    expect(await repository.commitScan([base], cursor)).toBe(1);
    expect(await repository.commitScan([updated], cursor)).toBe(1);
    expect((await repository.getRecords())[0]?.usage.outputTokens).toBe(4);
  });

  it("atomically replaces one source while preserving other sources and buckets", async () => {
    const repository = new MemoryUsageRepository();
    const usage = { inputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
    await repository.putRecords([
      { id: "codex-v4-a", source: "codex", sourcePath: "sessions/a.jsonl", timestamp: 1, model: "gpt-4", projectKey: "p", usage },
      { id: "codex-v4-b", source: "codex", sourcePath: "sessions/b.jsonl", timestamp: 2, model: "gpt-4", projectKey: "p", usage },
      { id: "claude-c", source: "claude", sourcePath: "claude/c.jsonl", timestamp: 3, model: "claude", projectKey: "q", usage },
    ]);
    const oldCursor = (path: string): FileCursor => ({ key: `codex:${path}`, source: "codex", path, offset: 10, size: 10, modifiedAt: 1, pendingText: "", parserVersion: 4 });
    await repository.putCursor(oldCursor("sessions/a.jsonl"));
    await repository.putCursor(oldCursor("sessions/b.jsonl"));
    await repository.putCursor({ key: "claude:claude/c.jsonl", source: "claude", path: "claude/c.jsonl", offset: 10, size: 10, modifiedAt: 1, pendingText: "", parserVersion: 4 });
    await repository.putBuckets([{ id: "old", bucketStart: 0, source: "codex", model: "gpt-4", projectKey: "p", usage, recordCount: 2, sessionCount: 2 }]);
    const nextRecord = { id: "codex-v5", source: "codex" as const, sourcePath: "archived_sessions/a.jsonl", timestamp: 4, model: "gpt-5", projectKey: "p", usage };
    const nextCursor: FileCursor = { key: "codex:archived_sessions/a.jsonl", source: "codex", path: "archived_sessions/a.jsonl", logicalId: "session-a", offset: 20, size: 20, modifiedAt: 2, pendingText: "", parserVersion: 5 };
    const nextBuckets = [{ id: "next", bucketStart: 0, source: "codex" as const, model: "gpt-5", projectKey: "p", usage, recordCount: 1, sessionCount: 1 }];

    const result = await repository.replaceSourceSnapshot("codex", [nextRecord], [nextCursor], nextBuckets);

    expect(result.recordChanges).toBe(3);
    expect(result.cursorChanges).toBe(3);
    expect((await repository.getRecords()).map((record) => record.id).sort()).toEqual(["claude-c", "codex-v5"]);
    expect((await repository.getCursors()).map((cursor) => cursor.key).sort()).toEqual(["claude:claude/c.jsonl", "codex:archived_sessions/a.jsonl"]);
    expect(await repository.getBuckets()).toEqual(nextBuckets);
  });

  it("rejects records from a different source before replacing anything", async () => {
    const repository = new MemoryUsageRepository();
    await expect(repository.replaceSourceSnapshot("codex", [{ id: "claude", source: "claude", timestamp: 1, model: "claude", projectKey: "p", usage: { inputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 } }], [], [])).rejects.toThrow("SOURCE_SNAPSHOT_RECORD_MISMATCH");
  });
});
