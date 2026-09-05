import { ref, watch } from "vue";
import { defineStore } from "pinia";
import { DexieUsageRepository } from "@lw-aiusage/storage";
import { QueryService, type StatsData } from "@lw-aiusage/application";
import { useUsageStore } from "./usage";

const emptyStats = (): StatsData => ({ byModel: [], byProject: [] });
export const useStatsStore = defineStore("stats", () => {
  const runtime = useUsageStore();
  const service = new QueryService(new DexieUsageRepository());
  const data = ref<StatsData>(emptyStats());
  const loading = ref(false);
  async function refresh(): Promise<void> {
    loading.value = true;
    try { data.value = await service.stats(); } finally { loading.value = false; }
  }
  watch(() => runtime.dataRevision, () => { void refresh(); }, { immediate: true });
  return { data, loading, refresh };
});
