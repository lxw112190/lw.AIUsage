import { ref, watch } from "vue";
import { defineStore } from "pinia";
import { DexieUsageRepository } from "@lw-aiusage/storage";
import { SessionUsageService, type SessionDetailData, type SessionListResult, type SessionSort, type SessionFilters } from "@lw-aiusage/application";
import { useUsageStore } from "./usage";

export interface ActiveSessionQuery {
  filters: SessionFilters;
  order: SessionSort;
  page: number;
  pageSize: number;
}

export const useSessionsStore = defineStore("sessions", () => {
  const service = new SessionUsageService(new DexieUsageRepository());
  const runtime = useUsageStore();
  const data = ref<SessionListResult>({ items: [], page: 1, pageSize: 30, total: 0, totalPages: 1, unassignedRecordCount: 0, unassignedTokens: 0 });
  const detail = ref<SessionDetailData>();
  const loading = ref(false);
  const error = ref<string>();
  const modelOptions = ref<string[]>([]);
  const projectKeys = ref<string[]>([]);
  let sequence = 0;
  let activeQuery: ActiveSessionQuery | undefined;
  async function executeQuery(query: ActiveSessionQuery): Promise<void> {
    const current = ++sequence;
    loading.value = true;
    try {
      const value = await service.list(query);
      if (current === sequence) {
        data.value = value;
        activeQuery = { ...query, filters: { ...query.filters }, page: value.page, pageSize: value.pageSize };
        error.value = undefined;
      }
    } catch (cause) {
      if (current === sequence) error.value = cause instanceof Error ? cause.message : "Unable to load sessions";
    } finally {
      if (current === sequence) loading.value = false;
    }
  }
  async function load(filters: SessionFilters = {}, order: SessionSort = "recent", page = 1): Promise<void> {
    activeQuery = { filters: { ...filters }, order, page, pageSize: data.value.pageSize };
    await executeQuery(activeQuery);
  }
  async function refreshCurrent(): Promise<void> {
    if (!activeQuery) return;
    await executeQuery({ ...activeQuery, filters: { ...activeQuery.filters } });
  }
  async function loadDetail(source: "codex" | "claude", sessionId: string): Promise<void> { detail.value = await service.detail(source, sessionId); }
  function clearDetail(): void { detail.value = undefined; }
  async function loadOptions(): Promise<void> { const value = await service.filterOptions(); modelOptions.value = value.models; projectKeys.value = value.projects; }
  watch(() => runtime.dataRevision, () => { void refreshCurrent(); void loadOptions(); });
  void loadOptions();
  return { data, detail, loading, error, modelOptions, projectKeys, load, refreshCurrent, loadDetail, clearDetail, loadOptions, pageSizeOptions: [20, 50, 100] as const };
});
