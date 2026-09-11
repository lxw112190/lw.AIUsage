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
  const error = ref<string>();
  let sequence = 0;
  async function load(projectKey: string, range: ProjectInsightRange): Promise<void> {
    const current = ++sequence; loading.value = true; error.value = undefined;
    try { const result = await service.get(projectKey, range); if (current === sequence) data.value = result; }
    catch (cause) { if (current === sequence) error.value = cause instanceof Error ? cause.message : "Unable to load project insights"; }
    finally { if (current === sequence) loading.value = false; }
  }
  watch(() => runtime.dataRevision, () => { data.value = undefined; });
  return { data, loading, error, load };
});
