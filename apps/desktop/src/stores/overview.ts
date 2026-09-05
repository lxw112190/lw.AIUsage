import { ref, watch } from "vue";
import { defineStore } from "pinia";
import { DexieUsageRepository } from "@lw-aiusage/storage";
import { QueryService, type DashboardData } from "@lw-aiusage/application";
import { useUsageStore } from "./usage";

const emptyDashboard = (): DashboardData => ({ records: 0, totalTokens: 0, estimatedCostUsd: 0, bySource: {}, bySourceRecords: {}, trend: [] });
export const useOverviewStore = defineStore("overview", () => {
  const runtime = useUsageStore();
  const service = new QueryService(new DexieUsageRepository());
  const data = ref<DashboardData>(emptyDashboard());
  const loading = ref(false);
  async function refresh(): Promise<void> {
    loading.value = true;
    try { data.value = await service.dashboard(); } finally { loading.value = false; }
  }
  watch(() => runtime.dataRevision, () => { void refresh(); }, { immediate: true });
  return { data, loading, refresh };
});
