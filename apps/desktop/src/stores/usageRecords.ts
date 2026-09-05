import { shallowRef, ref, watch } from "vue";
import { defineStore } from "pinia";
import { projectDisplayName, type AgentSource, type UsageRecord } from "@lw-aiusage/core";
import { DexieUsageRepository, type UsagePageResult } from "@lw-aiusage/storage";
import { QueryService } from "@lw-aiusage/application";
import { useUsageStore } from "./usage";

const pageSizeOptions = [20, 50, 100] as const;
const toTimestamp = (value: string, end = false): number | undefined => {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  if (end) date.setDate(date.getDate() + 1);
  return date.getTime();
};

export const useUsageRecordsStore = defineStore("usageRecords", () => {
  const repository = new DexieUsageRepository();
  const query = new QueryService(repository);
  const runtime = useUsageStore();
  const items = shallowRef<UsageRecord[]>([]);
  const page = ref(1);
  const pageSize = ref<number>(50);
  const total = ref(0);
  const totalPages = ref(1);
  const loading = ref(false);
  const error = ref<string>();
  const sourceFilter = ref<AgentSource | "">("");
  const modelFilter = ref("");
  const projectFilter = ref("");
  const fromDate = ref("");
  const toDate = ref("");
  const modelOptions = ref<string[]>([]);
  const projectOptions = ref<Array<{ key: string; name: string }>>([]);
  let querySequence = 0;

  async function loadPage(): Promise<void> {
    const sequence = ++querySequence;
    loading.value = true;
    error.value = undefined;
    try {
      const result: UsagePageResult = await query.recordsPage({
        page: page.value,
        pageSize: pageSize.value,
        order: "desc",
        source: sourceFilter.value || undefined,
        model: modelFilter.value || undefined,
        projectKey: projectFilter.value || undefined,
        from: toTimestamp(fromDate.value),
        to: toTimestamp(toDate.value, true),
      });
      if (sequence !== querySequence) return;
      items.value = result.items;
      page.value = result.page;
      total.value = result.total;
      totalPages.value = result.totalPages;
    } catch (cause) {
      if (sequence === querySequence)
        error.value = cause instanceof Error ? cause.message : "Unable to load records";
    } finally {
      if (sequence === querySequence) loading.value = false;
    }
  }
  async function loadOptions(): Promise<void> {
    const [models, projects] = await Promise.all([
      query.modelOptions(),
      query.projectOptions(),
    ]);
    modelOptions.value = models;
    projectOptions.value = projects.map((key) => ({ key, name: projectDisplayName(key) }));
  }
  function clearFilters(): void {
    sourceFilter.value = "";
    modelFilter.value = "";
    projectFilter.value = "";
    fromDate.value = "";
    toDate.value = "";
  }
  function setPage(value: number): void {
    page.value = Math.max(1, Math.min(value, totalPages.value));
    void loadPage();
  }
  function setPageSize(value: number): void {
    if (!pageSizeOptions.includes(value as (typeof pageSizeOptions)[number])) return;
    pageSize.value = value;
    page.value = 1;
    void loadPage();
  }
  watch([sourceFilter, modelFilter, projectFilter, fromDate, toDate], () => {
    page.value = 1;
    void loadPage();
  });
  watch(() => runtime.dataRevision, () => {
    void loadPage();
    void loadOptions();
  });
  void loadOptions();
  void loadPage();
  return {
    items, page, pageSize, pageSizeOptions, total, totalPages, loading, error,
    sourceFilter, modelFilter, projectFilter, fromDate, toDate,
    modelOptions, projectOptions, loadPage, loadOptions, clearFilters, setPage, setPageSize,
  };
});
