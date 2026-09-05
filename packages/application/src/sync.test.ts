import { describe, expect, it } from "vitest";
import type {
  Collector,
  CollectorFile,
  FileScanResult,
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
});
