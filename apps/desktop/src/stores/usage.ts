import { ref } from "vue";
import { defineStore } from "pinia";
import {
  createNodeDevPlatform,
  createWeb2AppPlatform,
  isWeb2AppRuntime,
} from "@lw-aiusage/platform";
import type { WatchHandle } from "@lw-aiusage/platform";
import { DexieUsageRepository } from "@lw-aiusage/storage";
import { defaultCollectors } from "@lw-aiusage/collectors";
import {
  detectCollectors,
  type CollectorDetectionResult,
  DiagnosticsService,
  SyncManager,
} from "@lw-aiusage/application";
import { JsonlWorkerParser } from "../workers/jsonlParser";

/** Runtime-only state. Page records live in usageRecords.ts. */
export const useUsageStore = defineStore("runtime", () => {
  const repository = new DexieUsageRepository();
  const platform = isWeb2AppRuntime()
    ? createWeb2AppPlatform()
    : createNodeDevPlatform();
  const parser = new JsonlWorkerParser();
  const collectors = defaultCollectors();
  const diagnostics = new DiagnosticsService();
  const manager = new SyncManager(platform, repository, collectors, parser);
  const collectorStatuses = ref<CollectorDetectionResult[]>([]);
  const syncing = ref(false);
  const lastSync = ref<number>();
  const error = ref<string>();
  const dataRevision = ref(0);
  let watchHandle: WatchHandle | undefined;

  async function refreshCollectorStatuses(): Promise<void> {
    collectorStatuses.value = await detectCollectors(platform, collectors);
  }
  async function rebuild(): Promise<void> {
    await repository.resetStatistics();
    dataRevision.value += 1;
    await sync();
  }
  async function resetLocalData(): Promise<void> {
    await repository.resetStatistics();
    dataRevision.value += 1;
  }
  async function sync(): Promise<void> {
    if (syncing.value) return;
    syncing.value = true;
    error.value = undefined;
    diagnostics.add("INFO", "Usage sync started");
    try {
      await refreshCollectorStatuses();
      const result = await manager.sync();
      for (const message of result.diagnostics)
        diagnostics.add("WARN", message, "collector");
      dataRevision.value += 1;
      await refreshCollectorStatuses();
      lastSync.value = Date.now();
      diagnostics.add(
        "INFO",
        `Usage sync complete: ${result.inserted} changed records (${result.skipped} unchanged)`,
      );
      if (!watchHandle)
        watchHandle = await manager.startWatching((watchResult) => {
          for (const message of watchResult.diagnostics)
            diagnostics.add("WARN", message, "collector");
          if (watchResult.inserted > 0) {
            dataRevision.value += 1;
            lastSync.value = Date.now();
          }
        });
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Sync failed";
      diagnostics.add("ERROR", error.value, "sync");
    } finally {
      syncing.value = false;
    }
  }
  function exportDiagnostics(): void {
    const blob = new Blob([diagnostics.exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lw-aiusage-diagnostics.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  return {
    collectorStatuses,
    syncing,
    lastSync,
    error,
    dataRevision,
    refreshCollectorStatuses,
    sync,
    rebuild,
    resetLocalData,
    exportDiagnostics,
  };
});
