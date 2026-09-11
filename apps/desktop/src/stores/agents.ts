import { ref, watch } from "vue";
import { defineStore } from "pinia";
import { DexieUsageRepository } from "@lw-aiusage/storage";
import { QueryService, type AgentUsageSummary } from "@lw-aiusage/application";
import { useUsageStore } from "./usage";

export const useAgentsStore = defineStore("agents", () => {
  const runtime = useUsageStore();
  const service = new QueryService(new DexieUsageRepository());
  const items = ref<AgentUsageSummary[]>([]);
  const loading = ref(false);
  async function refresh(): Promise<void> { loading.value = true; try { items.value = await service.agentSummaries(); } finally { loading.value = false; } }
  watch(() => runtime.dataRevision, () => { void refresh(); }, { immediate: true });
  return { items, loading, refresh };
});
