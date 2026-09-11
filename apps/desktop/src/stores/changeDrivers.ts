import { ref, watch } from "vue";
import { defineStore } from "pinia";
import { DexieUsageRepository } from "@lw-aiusage/storage";
import { ChangeDriverService, type ChangeDriverResult, type ComparisonPeriod } from "@lw-aiusage/application";
import { useUsageStore } from "./usage";

export const useChangeDriversStore = defineStore("changeDrivers", () => {
  const runtime = useUsageStore();
  const service = new ChangeDriverService(new DexieUsageRepository());
  const data = ref<ChangeDriverResult>();
  const loading = ref(false);
  let sequence = 0;
  async function load(period: ComparisonPeriod): Promise<void> { const current = ++sequence; loading.value = true; try { const result = await service.get(period); if (current === sequence) data.value = result; } finally { if (current === sequence) loading.value = false; } }
  watch(() => runtime.dataRevision, () => { if (data.value) void load(data.value.period); });
  return { data, loading, load };
});
