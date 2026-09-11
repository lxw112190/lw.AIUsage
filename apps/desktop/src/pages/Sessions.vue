<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "../i18n";
import { formatTokenDetail } from "../format";
import { useProjectPreferencesStore } from "../stores/projects";
import { useSessionsStore } from "../stores/sessions";
import SessionDetailDrawer from "../components/SessionDetailDrawer.vue";
import { parseUsageRouteQuery, type UsageDatePreset } from "../usageRoute";
import { buildUsageRouteQuery } from "../usageRoute";
import { QueryService } from "@lw-aiusage/application";
import { DexieUsageRepository } from "@lw-aiusage/storage";

const store = useSessionsStore();
const projects = useProjectPreferencesStore();
const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const order = ref<"recent" | "tokens" | "span">("recent");
const sourceFilter = ref<"" | "codex" | "claude">("");
const modelFilter = ref("");
const projectFilter = ref("");
const modelOptions = ref<string[]>([]);
const projectKeys = ref<string[]>([]);
const syncingRoute = ref(false);
const queryService = new QueryService(new DexieUsageRepository());
const projectOptions = computed(() => projectKeys.value.filter((key) => !projects.isHidden(key)).map((key) => ({ key, name: projects.nameFor(key) })));
const presets: UsageDatePreset[] = ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth", "all"];
const pages = computed(() => {
  const values: Array<number | "…"> = [];
  const start = Math.max(1, store.data.page - 2);
  const end = Math.min(store.data.totalPages, store.data.page + 2);
  if (start > 1) values.push(1, ...(start > 2 ? ["…"] : []));
  for (let value = start; value <= end; value += 1) values.push(value);
  if (end < store.data.totalPages) values.push(...(end < store.data.totalPages - 1 ? ["…"] : []), store.data.totalPages);
  return values;
});
const filters = () => { const value = parseUsageRouteQuery(route.query); return { from: value.from, to: value.to, source: sourceFilter.value || undefined, model: modelFilter.value || undefined, projectKey: projectFilter.value || undefined }; };
async function loadOptions(): Promise<void> { [modelOptions.value, projectKeys.value] = await Promise.all([queryService.modelOptions(), queryService.projectOptions()]); await projects.load(); }
async function applyRoute(): Promise<void> { syncingRoute.value = true; const value = parseUsageRouteQuery(route.query); sourceFilter.value = value.source ?? ""; modelFilter.value = value.model ?? ""; projectFilter.value = value.projectKey ?? ""; await refresh(); syncingRoute.value = false; }
async function refresh(): Promise<void> {
  await store.load(filters(), order.value, 1);
  const value = parseUsageRouteQuery(route.query);
  const session = typeof route.query.session === "string" ? route.query.session : undefined;
  if (value.source && session) await store.loadDetail(value.source, session);
  else store.clearDetail();
}
function closeDetail(): void {
  const query = { ...route.query };
  delete query.session;
  store.clearDetail();
  void router.replace({ path: "/sessions", query });
}
function selectPreset(preset: UsageDatePreset): void { void router.replace({ path: "/sessions", query: buildUsageRouteQuery({ preset, source: sourceFilter.value || undefined, model: modelFilter.value || undefined, projectKey: projectFilter.value || undefined }) }); }
function selectSession(source: "codex" | "claude", sessionId: string): void { void router.replace({ path: "/sessions", query: { ...route.query, source, session: sessionId } }); }
function viewUsage(): void { if (!store.detail) return; void router.push({ path: "/usage", query: { source: store.detail.summary.source, session: store.detail.summary.sessionId } }); }
function setPage(page: number): void { if (page < 1 || page > store.data.totalPages || page === store.data.page) return; void store.load(filters(), order.value, page); }
function setPageSize(value: number): void { if (!store.pageSizeOptions.includes(value as 20 | 50 | 100)) return; store.data.pageSize = value; void store.load(filters(), order.value, 1); }
function updateFilterRoute(): void { if (syncingRoute.value) return; void router.replace({ path: "/sessions", query: buildUsageRouteQuery({ preset: parseUsageRouteQuery(route.query).preset, source: sourceFilter.value || undefined, model: modelFilter.value || undefined, projectKey: projectFilter.value || undefined }) }); }
watch(() => route.fullPath, () => { void applyRoute(); }, { immediate: true });
watch(order, () => { void refresh(); });
watch([sourceFilter, modelFilter, projectFilter], updateFilterRoute);
void loadOptions();
</script>
<template>
  <section class="page">
    <div class="page-heading"><div><h2>{{ t("sessions.title") }}</h2><p>{{ t("sessions.description") }}</p></div><select class="sort-select" v-model="order"><option value="recent">{{ t("sessions.sortRecent") }}</option><option value="tokens">{{ t("sessions.sortTokens") }}</option><option value="span">{{ t("sessions.sortSpan") }}</option></select></div>
    <article class="panel preset-panel"><span class="preset-caption">{{ t("filter.presets") }}</span><div class="preset-list"><button v-for="preset in presets" :key="preset" :class="{ active: parseUsageRouteQuery(route.query).preset === preset }" @click="selectPreset(preset)">{{ t(`filter.preset.${preset}`) }}</button></div></article>
    <article class="panel filter-panel session-filter-panel"><div class="filter-field"><label>{{ t("filter.agent") }}</label><select v-model="sourceFilter"><option value="">{{ t("filter.allAgents") }}</option><option value="codex">Codex</option><option value="claude">Claude Code</option></select></div><div class="filter-field"><label>{{ t("filter.model") }}</label><select v-model="modelFilter"><option value="">{{ t("filter.allModels") }}</option><option v-for="model in modelOptions" :key="model" :value="model">{{ model }}</option></select></div><div class="filter-field"><label>{{ t("filter.project") }}</label><select v-model="projectFilter"><option value="">{{ t("filter.allProjects") }}</option><option v-for="project in projectOptions" :key="project.key" :value="project.key">{{ project.name }}</option></select></div><button class="clear-button" @click="sourceFilter = ''; modelFilter = ''; projectFilter = ''">{{ t("filter.clear") }}</button></article>
    <article class="panel table-panel" :class="{ 'is-loading': store.loading }">
      <div class="session-table-wrap"><table class="sessions-table"><thead><tr><th>{{ t("sessions.session") }}</th><th>{{ t("filter.agent") }}</th><th>{{ t("filter.project") }}</th><th>{{ t("filter.model") }}</th><th>{{ t("sessions.records") }}</th><th>{{ t("usage.total") }}</th><th>{{ t("sessions.lastActive") }}</th></tr></thead><tbody><tr v-for="item in store.data.items" :key="item.key" class="usage-row" @click="selectSession(item.source, item.sessionId)"><td><strong :title="item.sessionId">{{ item.sessionId }}</strong></td><td><span class="source-badge">{{ item.source }}</span></td><td :title="projects.nameFor(item.primaryProjectKey)">{{ projects.nameFor(item.primaryProjectKey) }}<span v-if="item.projects.length > 1" class="muted"> +{{ item.projects.length - 1 }}</span></td><td :title="item.primaryModel">{{ item.primaryModel }}<span v-if="item.models.length > 1" class="muted"> +{{ item.models.length - 1 }}</span></td><td>{{ item.recordCount }}</td><td><strong>{{ formatTokenDetail(item.totalTokens, locale) }}</strong></td><td>{{ new Date(item.lastActiveAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US") }}</td></tr><tr v-if="!store.data.items.length"><td colspan="7" class="empty-cell">{{ t("sessions.empty") }}</td></tr></tbody></table></div>
      <div class="table-footer"><span>{{ store.data.total }} {{ t("sessions.title") }} · {{ store.data.unassignedRecordCount }} {{ t("sessions.unassigned") }}</span><label>{{ t("usage.pageSize") }} <select :value="store.data.pageSize" @change="setPageSize(Number(($event.target as HTMLSelectElement).value))"><option v-for="size in store.pageSizeOptions" :key="size" :value="size">{{ size }}</option></select></label><div class="pagination"><button :disabled="store.data.page <= 1" @click="setPage(store.data.page - 1)">‹</button><template v-for="(item, index) in pages" :key="`${item}-${index}`"><span v-if="item === '…'" class="page-ellipsis">…</span><button v-else :class="{ active: item === store.data.page }" @click="setPage(item)">{{ item }}</button></template><button :disabled="store.data.page >= store.data.totalPages" @click="setPage(store.data.page + 1)">›</button></div></div>
    </article>
    <SessionDetailDrawer v-if="store.detail" :detail="store.detail" @close="closeDetail" @view-usage="viewUsage" />
  </section>
</template>
