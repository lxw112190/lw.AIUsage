import { ref, watch } from "vue";
import { defineStore } from "pinia";
import { DexieUsageRepository } from "@lw-aiusage/storage";
import { SessionUsageService, type SessionDetailData, type SessionListResult, type SessionSort, type SessionFilters } from "@lw-aiusage/application";
import { useUsageStore } from "./usage";

export const useSessionsStore = defineStore("sessions", () => {
  const service = new SessionUsageService(new DexieUsageRepository());
  const runtime = useUsageStore();
  const data = ref<SessionListResult>({ items: [], page: 1, pageSize: 30, total: 0, totalPages: 1, unassignedRecordCount: 0, unassignedTokens: 0 });
  const detail = ref<SessionDetailData>();
  const loading = ref(false);
  const error = ref<string>();
  let sequence = 0;
  async function load(filters: SessionFilters = {}, order: SessionSort = "recent", page = 1): Promise<void> {
    const current = ++sequence;
    loading.value = true;
    try { const value = await service.list({ filters, order, page, pageSize: data.value.pageSize }); if (current === sequence) data.value = value; } catch (cause) { if (current === sequence) error.value = cause instanceof Error ? cause.message : "Unable to load sessions"; } finally { if (current === sequence) loading.value = false; }
  }
  async function loadDetail(source: "codex" | "claude", sessionId: string): Promise<void> { detail.value = await service.detail(source, sessionId); }
  function clearDetail(): void { detail.value = undefined; }
  watch(() => runtime.dataRevision, () => { void load(); });
  return { data, detail, loading, error, load, loadDetail, clearDetail, pageSizeOptions: [20, 50, 100] as const };
});
