import { describe, expect, it } from "vitest";
import type {
  Collector,
  CollectorFile,
  FileScanResult,
  SourceScanResult,
} from "@lw-aiusage/collectors";
import { createFixturePlatform } from "@lw-aiusage/platform";
import { MemoryUsageRepository } from "@lw-aiusage/storage";
import { SyncManager } from "./sync";

describe("SyncManager", () => {
  it("coalesces concurrent syncs and skips unchanged files", async () => {
    const file: CollectorFile = {
      path: "/fixture/.codex/sessions/demo.jsonl",
      name: "demo.jsonl",
      isFile: true,
      isDirectory: false,
      size: 10,
      modifiedAt: 1,
      source: "codex",
    };
    let scans = 0;
    const collector: Collector = {
      source: "codex",
      name: "Codex",
      parserVersion: 2,
      scanMode: "file",
      fileReconcileMode: "logical-singleton",
      roots: async () => [],
      detect: async () => ({ installed: true, dataAvailable: true, roots: [] }),
      discoverFiles: async () => [file],
      scanFile: async (): Promise<FileScanResult> => {
        scans += 1;
        return {
          records: [
            {
              id: "codex:event",
              source: "codex",
              sourcePath: file.path,
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
            },
          ],
          diagnostics: [],
          cursor: {
            key: "codex:" + file.path,
            source: "codex",
            path: file.path,
            offset: file.size,
            size: file.size,
            modifiedAt: file.modifiedAt,
            pendingText: "",
            parserVersion: 2,
          },
        };
      },
    };
    const manager = new SyncManager(
      createFixturePlatform({}),
      new MemoryUsageRepository(),
      [collector],
    );
    const [first, concurrent] = await Promise.all([
      manager.sync(),
      manager.sync(),
    ]);
    expect(scans).toBe(1);
    expect(first.inserted).toBe(1);
    expect(concurrent.inserted).toBe(1);
    const second = await manager.sync();
    expect(second.skipped).toBe(1);
    expect(scans).toBe(1);
  });

  it("scans a source as a whole, skips unchanged snapshots, and retries parser upgrades", async () => {
    const files: CollectorFile[] = [
      { path: "/fixture/.codex/sessions/a.jsonl", name: "a.jsonl", isFile: true, isDirectory: false, size: 10, modifiedAt: 1, source: "codex", logicalId: "session-a" },
      { path: "/fixture/.codex/archived_sessions/a.jsonl", name: "a.jsonl", isFile: true, isDirectory: false, size: 10, modifiedAt: 1, source: "codex", logicalId: "session-a" },
    ];
    let parserVersion = 4;
    let scans = 0;
    const collector: Collector = {
      source: "codex",
      name: "Codex V5 test",
      parserVersion,
      scanMode: "source",
      roots: async () => [],
      detect: async () => ({ installed: true, dataAvailable: true, roots: [] }),
      discoverFiles: async () => files,
      scanSource: async (): Promise<SourceScanResult> => {
        scans += 1;
        return {
          records: [{ id: "v5-record", source: "codex", sourcePath: files[0]!.path, timestamp: 1, model: "gpt-5", projectKey: "demo", usage: { inputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 } }],
          cursors: files.map((file) => ({ key: `codex:${file.path}`, source: "codex" as const, path: file.path, logicalId: file.logicalId, offset: file.size, size: file.size, modifiedAt: file.modifiedAt, pendingText: "", parserVersion })),
          diagnostics: [],
          safeToCommit: true,
        };
      },
    };
    const repository = new MemoryUsageRepository();
    const manager = new SyncManager(createFixturePlatform({}), repository, [collector]);

    const first = await manager.sync();
    const second = await manager.sync();
    expect(first.inserted).toBe(1);
    expect(first.skipped).toBe(0);
    expect(second.skipped).toBe(2);
    expect(scans).toBe(1);

    parserVersion = 5;
    const upgraded = { ...collector, parserVersion } as Collector;
    const replay = await new SyncManager(createFixturePlatform({}), repository, [upgraded]).sync();
    expect(replay.skipped).toBe(0);
    expect(scans).toBe(2);
    expect((await repository.getCursors()).every((cursor) => cursor.parserVersion === 5)).toBe(true);
  });

  it("does not commit an unsafe source snapshot", async () => {
    const file: CollectorFile = { path: "/fixture/.codex/sessions/demo.jsonl", name: "demo.jsonl", isFile: true, isDirectory: false, size: 10, modifiedAt: 1, source: "codex", logicalId: "session" };
    const cursor = { key: `codex:${file.path}`, source: "codex" as const, path: file.path, logicalId: file.logicalId, offset: file.size, size: file.size, modifiedAt: file.modifiedAt, pendingText: "", parserVersion: 5 };
    const record = { id: "old", source: "codex" as const, sourcePath: file.path, timestamp: 1, model: "gpt-5", projectKey: "demo", usage: { inputTokens: 10, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 } };
    const repository = new MemoryUsageRepository();
    await repository.putRecords([record]);
    await repository.putCursor(cursor);
    const collector: Collector = {
      source: "codex",
      name: "Codex V5 test",
      parserVersion: 5,
      scanMode: "source",
      roots: async () => [],
      detect: async () => ({ installed: true, dataAvailable: true, roots: [] }),
      discoverFiles: async () => [{ ...file, modifiedAt: 2 }],
      scanSource: async () => ({ records: [], cursors: [], diagnostics: ["V5_UNSAFE"], safeToCommit: false }),
    };

    const result = await new SyncManager(createFixturePlatform({}), repository, [collector]).sync();
    expect(result.diagnostics).toEqual(["V5_UNSAFE"]);
    expect(await repository.getRecords({ source: "codex" })).toEqual([record]);
    expect(await repository.getCursors()).toEqual([cursor]);
  });
});
