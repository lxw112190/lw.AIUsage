import { ref } from "vue";
import { defineStore } from "pinia";
import {
  createNodeDevPlatform,
  createWeb2AppPlatform,
  isWeb2AppRuntime,
} from "@lw-aiusage/platform";
import type { WatchHandle } from "@lw-aiusage/platform";
import { DexieUsageRepository } from "@lw-aiusage/storage";
import { defaultCollectors, type CollectorProgress } from "@lw-aiusage/collectors";
import {
  detectCollectors,
  type CollectorDetectionResult,
  DiagnosticsService,
  SyncManager,
  UsageAuditService,
  CodexAccountingAuditService,
  type RebuildAuditResult,
  type SyncResult,
  type UsageAuditReport,
  type CodexRawAuditReport,
  type CodexAccountingAuditReport,
} from "@lw-aiusage/application";
import { JsonlWorkerParser } from "../workers/jsonlParser";

export type SyncReason = "startup" | "manual" | "watch" | "rebuild";

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
  const lastCheckedAt = ref<number>();
  const lastDataChangeAt = ref<number>();
  const syncReason = ref<SyncReason>();
  const lastSyncResult = ref<SyncResult>();
  const syncProgress = ref<Pick<CollectorProgress, "source" | "current" | "total">>();
  const error = ref<string>();
  const dataRevision = ref(0);
  const rebuildAudit = ref<RebuildAuditResult>();
  const auditReport = ref<UsageAuditReport>();
  const rawAuditReport = ref<CodexRawAuditReport>();
  const codexAccountingAuditReport = ref<CodexAccountingAuditReport>();
  const rawAuditProgress = ref<{ current: number; total: number }>();
  const rawAuditBusy = ref(false);
  let bootstrapped = false;
  let watchHandle: WatchHandle | undefined;
  const collectorVersions = Object.fromEntries(
    collectors.map((collector) => [collector.source, collector.parserVersion]),
  ) as Record<string, number>;
  const trackSyncProgress = (progress: CollectorProgress): void => {
    syncProgress.value = {
      source: progress.source,
      current: progress.current,
      total: progress.total,
    };
  };

  async function refreshCollectorStatuses(): Promise<void> {
    collectorStatuses.value = await detectCollectors(platform, collectors);
  }
  function applySyncResult(result: SyncResult, reason: SyncReason, forceRevision = false): void {
    const checkedAt = Date.now();
    lastSyncResult.value = result;
    lastSync.value = checkedAt;
    lastCheckedAt.value = checkedAt;
    syncReason.value = reason;
    for (const message of result.diagnostics)
      diagnostics.add("WARN", message, "collector");
    if (forceRevision || result.changedRecords > 0) {
      dataRevision.value += 1;
      lastDataChangeAt.value = checkedAt;
    }
  }
  async function handleWatchSync(watchResult: SyncResult): Promise<void> {
    applySyncResult(watchResult, "watch");
  }
  async function startWatch(): Promise<void> {
    if (!watchHandle)
      watchHandle = await manager.startWatching((result) => {
        void handleWatchSync(result);
      });
  }
  async function rebuild(): Promise<void> {
    if (syncing.value || rawAuditBusy.value) return;
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
      const result = await manager.sync(trackSyncProgress);
      applySyncResult(result, "rebuild", true);
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
      await refreshCollectorStatuses();
      await startWatch();
      diagnostics.add("INFO", `Usage rebuild complete: ${result.changedRecords} records changed`);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Rebuild failed";
      diagnostics.add("ERROR", error.value, "rebuild");
    } finally {
      if (!watchHandle) {
        try { await startWatch(); }
        catch (cause) { diagnostics.add("ERROR", cause instanceof Error ? cause.message : "Unable to restart watcher", "watch"); }
      }
      syncing.value = false;
      syncProgress.value = undefined;
    }
  }
  async function resetLocalData(): Promise<void> {
    if (syncing.value || rawAuditBusy.value) return;
    syncing.value = true;
    error.value = undefined;
    const wasWatching = !!watchHandle;
    try {
      if (watchHandle) {
        await watchHandle.close();
        watchHandle = undefined;
      }
      await manager.waitForIdle();
      await repository.resetStatistics();
      rebuildAudit.value = undefined;
      auditReport.value = undefined;
      rawAuditReport.value = undefined;
      codexAccountingAuditReport.value = undefined;
      lastSyncResult.value = undefined;
      lastSync.value = undefined;
      lastCheckedAt.value = undefined;
      lastDataChangeAt.value = undefined;
      syncReason.value = undefined;
      dataRevision.value += 1;
      diagnostics.add("INFO", "Local usage data reset complete");
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Reset failed";
      diagnostics.add("ERROR", error.value, "reset");
      throw cause;
    } finally {
      if (wasWatching && !watchHandle) {
        try { await startWatch(); }
        catch (cause) { diagnostics.add("ERROR", cause instanceof Error ? cause.message : "Unable to restart watcher", "watch"); }
      }
      syncing.value = false;
    }
  }
  async function sync(reason: SyncReason = "manual"): Promise<void> {
    if (syncing.value || rawAuditBusy.value) return;
    syncing.value = true;
    error.value = undefined;
    diagnostics.add("INFO", "Usage sync started");
    try {
      await refreshCollectorStatuses();
      const result = await manager.sync(trackSyncProgress);
      applySyncResult(result, reason);
      await refreshCollectorStatuses();
      diagnostics.add(
        "INFO",
        `Usage sync complete: ${result.changedRecords} changed records (${result.skippedFiles} unchanged)`,
      );
      await startWatch();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Sync failed";
      diagnostics.add("ERROR", error.value, "sync");
    } finally {
      syncing.value = false;
      syncProgress.value = undefined;
    }
  }
  async function bootstrap(): Promise<void> {
    if (bootstrapped) return;
    bootstrapped = true;
    await sync("startup");
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
  async function runCodexRawAudit(): Promise<void> {
    if (rawAuditBusy.value || syncing.value) return;
    rawAuditBusy.value = true;
    rawAuditProgress.value = { current: 0, total: 0 };
    const wasWatching = !!watchHandle;
    try {
      if (watchHandle) {
        await watchHandle.close();
        watchHandle = undefined;
      }
      const report = await new CodexAccountingAuditService(platform, repository, async () => {
        const syncResult = await manager.sync();
        applySyncResult(syncResult, "manual");
      }).audit((current, total) => {
        rawAuditProgress.value = { current, total };
      });
      codexAccountingAuditReport.value = report;
      rawAuditReport.value = report.raw;
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "lw-aiusage-codex-accounting-audit-v3.json";
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      if (wasWatching && !watchHandle) {
        try { await startWatch(); }
        catch (cause) { diagnostics.add("ERROR", cause instanceof Error ? cause.message : "Unable to restart watcher", "watch"); }
      }
      rawAuditBusy.value = false;
    }
  }
  function recordError(message: string): void {
    error.value = message;
    diagnostics.add("ERROR", message, "audit");
  }
  return {
    collectorStatuses,
    syncing,
    lastSync,
    lastSyncResult,
    syncProgress,
    collectorVersions,
    error,
    dataRevision,
    lastCheckedAt,
    lastDataChangeAt,
    syncReason,
    rebuildAudit,
    auditReport,
    rawAuditReport,
    codexAccountingAuditReport,
    rawAuditProgress,
    rawAuditBusy,
    refreshCollectorStatuses,
    bootstrap,
    sync,
    rebuild,
    resetLocalData,
    exportDiagnostics,
    exportUsageAudit,
    runCodexRawAudit,
    recordError,
  };
});
