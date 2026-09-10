import { describe, expect, it } from "vitest";
import type {
  Collector,
  CollectorFile,
  FileScanResult,
  SourceScanResult,
} from "@lw-aiusage/collectors";
import { CodexCollectorV5 } from "@lw-aiusage/collectors";
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

  it("forces a source rescan when validation revision changes", async () => {
    const file: CollectorFile = { path: "/fixture/.codex/sessions/demo.jsonl", name: "demo.jsonl", isFile: true, isDirectory: false, size: 10, modifiedAt: 1, source: "codex", logicalId: "session" };
    const repository = new MemoryUsageRepository();
    const cursor = { key: `codex:${file.path}`, source: "codex" as const, path: file.path, logicalId: file.logicalId, offset: file.size, size: file.size, modifiedAt: file.modifiedAt, pendingText: "", parserVersion: 5, scanRevision: 0 };
    await repository.putCursor(cursor);
    let scans = 0;
    const collector: Collector = {
      source: "codex",
      name: "Codex V5 revision test",
      parserVersion: 5,
      scanRevision: 1,
      scanMode: "source",
      roots: async () => [],
      detect: async () => ({ installed: true, dataAvailable: true, roots: [] }),
      discoverFiles: async () => [file],
      scanSource: async () => {
        scans += 1;
        return { records: [], cursors: [cursor], diagnostics: [], safeToCommit: true };
      },
    };
    const result = await new SyncManager(createFixturePlatform({}), repository, [collector]).sync();

    expect(result.skipped).toBe(0);
    expect(scans).toBe(1);
    expect((await repository.getCursors())[0]?.scanRevision).toBe(0);
  });

  it("migrates, restarts, rebuilds, appends, archives, and deletes a V5 source deterministically", async () => {
    const firstContent = [
      JSON.stringify({ type: "session_meta", payload: { id: "session-a", cwd: "/repo" } }),
      JSON.stringify({ type: "token_count", timestamp: 100, payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 12, output_tokens: 3 } } } }),
    ].join("\n") + "\n";
    const appendedContent = `${firstContent}${JSON.stringify({ type: "token_count", timestamp: 110, payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 4, output_tokens: 1 } } } })}\n`;
    const activePath = "/fixture/.codex/sessions/a.jsonl";
    const archivePath = "/fixture/.codex/archived_sessions/a.jsonl";
    const oldRecord = { id: "codex:v4:old", source: "codex" as const, sourcePath: activePath, timestamp: 1, model: "gpt-4", projectKey: "demo", usage: { inputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 } };
    const oldCursor = { key: `codex:${activePath}`, source: "codex" as const, path: activePath, logicalId: "session-a", offset: firstContent.length, size: firstContent.length, modifiedAt: 1, pendingText: "", parserVersion: 4 };
    const repository = new MemoryUsageRepository();
    await repository.putRecords([oldRecord]);
    await repository.putCursor(oldCursor);

    const firstPlatform = createFixturePlatform({ [activePath]: firstContent });
    const firstSync = await new SyncManager(firstPlatform, repository, [new CodexCollectorV5()]).sync();
    const migrated = await repository.getRecords({ source: "codex" });
    expect(firstSync.inserted).toBe(2);
    expect(migrated).toHaveLength(1);
    expect(migrated[0]?.id).not.toBe(oldRecord.id);
    expect((await repository.getCursors()).every((cursor) => cursor.parserVersion === 5)).toBe(true);

    const fingerprint = JSON.stringify(migrated);
    const restarted = await new SyncManager(firstPlatform, repository, [new CodexCollectorV5()]).sync();
    expect(restarted.inserted).toBe(0);
    expect(restarted.skipped).toBe(1);
    expect(JSON.stringify(await repository.getRecords({ source: "codex" }))).toBe(fingerprint);

    const rebuiltRepository = new MemoryUsageRepository();
    await new SyncManager(firstPlatform, rebuiltRepository, [new CodexCollectorV5()]).sync();
    expect(await rebuiltRepository.getRecords({ source: "codex" })).toEqual(migrated);

    const appendedPlatform = createFixturePlatform({ [activePath]: appendedContent });
    await new SyncManager(appendedPlatform, repository, [new CodexCollectorV5()]).sync();
    const beforeArchive = await repository.getRecords({ source: "codex" });
    expect(beforeArchive).toHaveLength(2);

    const archivePlatform = createFixturePlatform({ [archivePath]: appendedContent });
    await new SyncManager(archivePlatform, repository, [new CodexCollectorV5()]).sync();
    const archived = await repository.getRecords({ source: "codex" });
    expect(archived).toHaveLength(2);
    expect(archived.every((record) => record.sourcePath === archivePath)).toBe(true);
    expect(archived.map(({ sourcePath: _sourcePath, ...record }) => record)).toEqual(
      beforeArchive.map(({ sourcePath: _sourcePath, ...record }) => record),
    );

    await new SyncManager(createFixturePlatform({}), repository, [new CodexCollectorV5()]).sync();
    expect(await repository.getRecords({ source: "codex" })).toEqual([]);
    expect((await repository.getCursors()).filter((cursor) => cursor.source === "codex")).toEqual([]);
  });
});
