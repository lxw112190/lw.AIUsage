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
  UsageAuditService,
  type RebuildAuditResult,
  type SyncResult,
  type UsageAuditReport,
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
  const rebuildAudit = ref<RebuildAuditResult>();
  const auditReport = ref<UsageAuditReport>();
  let watchHandle: WatchHandle | undefined;

  async function refreshCollectorStatuses(): Promise<void> {
    collectorStatuses.value = await detectCollectors(platform, collectors);
  }
  async function handleWatchSync(watchResult: SyncResult): Promise<void> {
    for (const message of watchResult.diagnostics)
      diagnostics.add("WARN", message, "collector");
    if (watchResult.inserted > 0) {
      dataRevision.value += 1;
      lastSync.value = Date.now();
    }
  }
  async function startWatch(): Promise<void> {
    if (!watchHandle)
      watchHandle = await manager.startWatching((result) => {
        void handleWatchSync(result);
      });
  }
  async function rebuild(): Promise<void> {
    if (syncing.value) return;
    syncing.value = true;
    error.value = undefined;
    try {
      const audit = new UsageAuditService(repository);
      const before = await audit.audit();
      if (watchHandle) {
        await watchHandle.close();
        watchHandle = undefined;
      }
      await repository.resetStatistics();
      const result = await manager.sync();
      const after = await audit.audit();
      rebuildAudit.value = {
        before,
        after,
        difference: {
          records: after.recordCount - before.recordCount,
          tokens: after.totals.currentTotal - before.totals.currentTotal,
          percent: before.totals.currentTotal
            ? ((after.totals.currentTotal - before.totals.currentTotal) / before.totals.currentTotal) * 100
            : 0,
        },
      };
      dataRevision.value += 1;
      await refreshCollectorStatuses();
      await startWatch();
      lastSync.value = Date.now();
      diagnostics.add("INFO", `Usage rebuild complete: ${result.inserted} records changed`);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Rebuild failed";
      diagnostics.add("ERROR", error.value, "rebuild");
    } finally {
      syncing.value = false;
    }
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
      await startWatch();
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
  async function exportUsageAudit(): Promise<void> {
    const report = await new UsageAuditService(repository).audit();
    auditReport.value = report;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lw-aiusage-usage-audit.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  return {
    collectorStatuses,
    syncing,
    lastSync,
    error,
    dataRevision,
    rebuildAudit,
    auditReport,
    refreshCollectorStatuses,
    sync,
    rebuild,
    resetLocalData,
    exportDiagnostics,
    exportUsageAudit,
  };
});
