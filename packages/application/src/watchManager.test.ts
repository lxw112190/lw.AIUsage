import { describe, expect, it, vi } from "vitest";
import type { Collector } from "@lw-aiusage/collectors";
import type { RuntimePlatform } from "@lw-aiusage/platform";
import { WatchManager } from "./watchManager";

describe("WatchManager", () => {
  it("adds new roots and closes roots that disappear", async () => {
    const existing = new Set(["/fixture/.codex"]);
    const closed: string[] = [];
    const watched: string[] = [];
    let detectCalls = 0;
    const collector: Collector = { source: "codex", name: "Codex", parserVersion: 3, fileReconcileMode: "logical-singleton", roots: async () => ["/fixture/.codex", "/fixture/.claude"], detect: async () => { detectCalls += 1; return { installed: true, dataAvailable: true, roots: ["/fixture/.codex", "/fixture/.claude"] }; }, discoverFiles: async () => [], scanFile: async () => { throw new Error("unused"); } };
    const platform: RuntimePlatform = { kind: "fixture", paths: { home: async () => "/fixture", appData: async () => "/fixture/app", appCache: async () => "/fixture/cache" }, fs: { exists: async (path) => existing.has(path), list: async () => [], stat: async () => ({ size: 0, modifiedAt: 0, isFile: false }), readRange: async () => new ArrayBuffer(0) }, watch: { watch: async (path) => { watched.push(path); return { close: async () => { closed.push(path); } }; } } };
    const manager = new WatchManager(platform, [collector], vi.fn());
    await manager.reconcile();
    expect(detectCalls).toBe(0);
    expect(watched).toEqual(["/fixture/.codex"]);
    existing.add("/fixture/.claude");
    await manager.reconcile();
    expect(watched).toEqual(["/fixture/.codex", "/fixture/.claude"]);
    existing.delete("/fixture/.codex");
    await manager.reconcile();
    expect(closed).toEqual(["/fixture/.codex"]);
    await manager.close();
    expect(closed).toEqual(["/fixture/.codex", "/fixture/.claude"]);
  });
});
