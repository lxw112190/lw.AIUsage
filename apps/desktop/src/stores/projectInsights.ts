import { ref, watch } from "vue";
import { defineStore } from "pinia";
import { DexieUsageRepository } from "@lw-aiusage/storage";
import { ProjectInsightService, type ProjectInsight, type ProjectInsightRange } from "@lw-aiusage/application";
import { useUsageStore } from "./usage";

export const useProjectInsightsStore = defineStore("projectInsights", () => {
  const runtime = useUsageStore();
  const service = new ProjectInsightService(new DexieUsageRepository());
  const data = ref<ProjectInsight>();
  const loading = ref(false);
  const refreshing = ref(false);
  const error = ref<string>();
  let sequence = 0;
  let activeQuery: { projectKey: string; range: ProjectInsightRange } | undefined;
  async function executeLoad(query: { projectKey: string; range: ProjectInsightRange }): Promise<void> {
    const current = ++sequence;
    const hasPrevious = !!data.value;
    if (hasPrevious) refreshing.value = true;
    else loading.value = true;
    error.value = undefined;
    try {
      const result = await service.get(query.projectKey, query.range);
      if (current === sequence) data.value = result;
    } catch (cause) {
      if (current === sequence) error.value = cause instanceof Error ? cause.message : "Unable to load project insights";
    } finally {
      if (current === sequence) {
        loading.value = false;
        refreshing.value = false;
      }
    }
  }
  async function load(projectKey: string, range: ProjectInsightRange): Promise<void> {
    activeQuery = { projectKey, range };
    await executeLoad(activeQuery);
  }
  async function refreshCurrent(): Promise<void> {
    if (!activeQuery) return;
    await executeLoad({ ...activeQuery });
  }
  watch(() => runtime.dataRevision, () => { void refreshCurrent(); });
  return { data, loading, refreshing, error, load, refreshCurrent };
});
