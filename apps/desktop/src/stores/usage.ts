import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { createNodeDevPlatform, createWeb2AppPlatform, isWeb2AppRuntime } from "@lw-aiusage/platform";
import type { WatchHandle } from "@lw-aiusage/platform";
import { DexieUsageRepository } from "@lw-aiusage/storage";
import { defaultCollectors } from "@lw-aiusage/collectors";
import { detectCollectors, type CollectorDetectionResult, DiagnosticsService, SyncManager } from "@lw-aiusage/application";
import { estimatedCostUsd, pricingForModel, projectDisplayName, totalTokens, type AgentSource, type UsageRecord } from "@lw-aiusage/core";
import { JsonlWorkerParser } from "../workers/jsonlParser";

export const useUsageStore = defineStore("usage", () => {
  const repository = new DexieUsageRepository(); const platform = isWeb2AppRuntime() ? createWeb2AppPlatform() : createNodeDevPlatform(); const parser = new JsonlWorkerParser(); const collectors = defaultCollectors(); const diagnostics = new DiagnosticsService(); const manager = new SyncManager(platform, repository, collectors, parser); const records = ref<UsageRecord[]>([]); const collectorStatuses = ref<CollectorDetectionResult[]>([]); const syncing = ref(false); const lastSync = ref<number>(); const error = ref<string>(); const sourceFilter = ref<AgentSource | "">(""); const modelFilter = ref(""); const projectFilter = ref(""); const fromDate = ref(""); const toDate = ref(""); let watchHandle: WatchHandle | undefined;
  const total = computed(() => records.value.reduce((sum, record) => sum + totalTokens(record.usage), 0));
  const byAgent = computed(() => records.value.reduce<Record<string, number>>((result, record) => { result[record.source] = (result[record.source] ?? 0) + totalTokens(record.usage); return result; }, {}));
  const estimatedCost = computed(() => records.value.reduce((sum, record) => { const pricing = pricingForModel(record.model); return sum + (pricing ? estimatedCostUsd(record.usage, pricing) : 0); }, 0));
  const modelOptions = computed(() => [...new Set(records.value.map((record) => record.model))].sort());
  const projectOptions = computed(() => [...new Set(records.value.map((record) => record.projectKey))].sort().map((key) => ({ key, name: projectDisplayName(key) })));
  const modelStats = computed(() => groupStats(records.value, (record) => record.model));
  const projectStats = computed(() => groupStats(records.value, (record) => record.projectKey));
  const filteredRecords = computed(() => { const from = fromDate.value ? new Date(`${fromDate.value}T00:00:00`).getTime() : undefined; const to = toDate.value ? new Date(`${toDate.value}T23:59:59.999`).getTime() : undefined; return records.value.filter((record) => (!sourceFilter.value || record.source === sourceFilter.value) && (!modelFilter.value || record.model === modelFilter.value) && (!projectFilter.value || record.projectKey === projectFilter.value) && (from === undefined || record.timestamp >= from) && (to === undefined || record.timestamp <= to)); });
  function clearFilters(): void { sourceFilter.value = ""; modelFilter.value = ""; projectFilter.value = ""; fromDate.value = ""; toDate.value = ""; }
  async function refresh(): Promise<void> { records.value = await repository.getRecords(); }
  async function refreshCollectorStatuses(): Promise<void> { collectorStatuses.value = await detectCollectors(platform, collectors); }
  async function rebuild(): Promise<void> { await repository.resetStatistics(); await refresh(); await sync(); }
  async function resetLocalData(): Promise<void> { await repository.resetStatistics(); await refresh(); }
  async function sync(): Promise<void> { syncing.value = true; error.value = undefined; diagnostics.add("INFO", "Usage sync started"); try { await refreshCollectorStatuses(); const result = await manager.sync(); for (const message of result.diagnostics) diagnostics.add("WARN", message, "collector"); await refresh(); await refreshCollectorStatuses(); lastSync.value = Date.now(); diagnostics.add("INFO", `Usage sync complete: ${result.inserted} new records`); if (!watchHandle) watchHandle = await manager.startWatching((watchResult) => { for (const message of watchResult.diagnostics) diagnostics.add("WARN", message, "collector"); if (watchResult.inserted > 0) { void refresh(); lastSync.value = Date.now(); } }); } catch (cause) { error.value = cause instanceof Error ? cause.message : "Sync failed"; diagnostics.add("ERROR", error.value, "sync"); } finally { syncing.value = false; } }
  function exportDiagnostics(): void { const blob = new Blob([diagnostics.exportJson()], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "lw-aiusage-diagnostics.json"; link.click(); URL.revokeObjectURL(url); }
  return { records, filteredRecords, collectorStatuses, syncing, lastSync, error, total, byAgent, estimatedCost, modelOptions, projectOptions, modelStats, projectStats, sourceFilter, modelFilter, projectFilter, fromDate, toDate, clearFilters, refresh, refreshCollectorStatuses, sync, rebuild, resetLocalData, exportDiagnostics };
});

function groupStats(records: readonly UsageRecord[], keyOf: (record: UsageRecord) => string): Array<{ key: string; records: number; tokens: number; cost: number }> {
  const groups = new Map<string, { key: string; records: number; tokens: number; cost: number }>();
  for (const record of records) {
    const key = keyOf(record); const current = groups.get(key); const pricing = pricingForModel(record.model); const cost = pricing ? estimatedCostUsd(record.usage, pricing) : 0;
    if (current) { current.records += 1; current.tokens += totalTokens(record.usage); current.cost += cost; }
    else groups.set(key, { key, records: 1, tokens: totalTokens(record.usage), cost });
  }
  return [...groups.values()].sort((left, right) => right.tokens - left.tokens);
}
