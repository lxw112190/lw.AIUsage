import { ref, watch } from "vue";
import { defineStore } from "pinia";
import { DexieUsageRepository } from "@lw-aiusage/storage";
import { QueryService, type ActivityGranularity, type ActivityViewData, type DashboardData } from "@lw-aiusage/application";
import { zeroUsage } from "@lw-aiusage/core";
import { useUsageStore } from "./usage";

const emptyDashboard = (): DashboardData => ({ records: 0, totalTokens: 0, estimatedCostUsd: 0, usage: zeroUsage(), bySource: {}, bySourceRecords: {}, trend: [], periods: [] });
export const useOverviewStore = defineStore("overview", () => {
  const runtime = useUsageStore();
  const service = new QueryService(new DexieUsageRepository());
  const data = ref<DashboardData>(emptyDashboard());
  const loading = ref(false);
  const activityData = ref<ActivityViewData>();
  const activityLoading = ref(false);
  const activityCache = new Map<string, ActivityViewData>();
  let activityRequestSequence = 0;
  async function refresh(): Promise<void> {
    loading.value = true;
    try { data.value = await service.dashboard(); } finally { loading.value = false; }
  }
  async function loadActivity(granularity: ActivityGranularity): Promise<void> {
    const sequence = ++activityRequestSequence;
    const key = `${runtime.dataRevision}:${granularity}`;
    const cached = activityCache.get(key);
    if (cached) {
      if (sequence === activityRequestSequence) activityData.value = cached;
      return;
    }
    activityLoading.value = true;
    try {
      const value = await service.activity(granularity);
      activityCache.set(key, value);
      if (sequence === activityRequestSequence) activityData.value = value;
    } finally {
      if (sequence === activityRequestSequence) activityLoading.value = false;
    }
  }
  watch(() => runtime.dataRevision, () => {
    activityCache.clear();
    void refresh();
    if (activityData.value) void loadActivity(activityData.value.granularity);
  }, { immediate: true });
  return { data, loading, refresh, activityData, activityLoading, loadActivity };
});
