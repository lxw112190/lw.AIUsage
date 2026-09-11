<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { totalTokens, type UsageRecord } from "@lw-aiusage/core";
import { useUsageRecordsStore } from "../stores/usageRecords";
import { useI18n } from "../i18n";
import { formatTokenAmount } from "../format";
import { useProjectPreferencesStore } from "../stores/projects";
import { usageRecordsToCsv } from "../csv";
import UsageDetailDrawer from "../components/UsageDetailDrawer.vue";
import { buildUsageRouteQuery, parseUsageRouteQuery, type UsageDatePreset } from "../usageRoute";

const store = useUsageRecordsStore();
const projects = useProjectPreferencesStore();
const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const selectedRecord = ref<UsageRecord>();
const syncingRoute = ref(false);
const presets: UsageDatePreset[] = ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth", "all"];
const presetLabel = (preset: UsageDatePreset): string => t(`filter.preset.${preset}`);
const format = (value: number): string => formatTokenAmount(value, { locale: locale.value, withUnitSuffix: true });
const dateTime = (value: number): string => new Date(value).toLocaleString(locale.value === "zh" ? "zh-CN" : "en-US");
const pages = computed(() => { const values: Array<number | "…"> = []; const start = Math.max(1, store.page - 2); const end = Math.min(store.totalPages, store.page + 2); if (start > 1) values.push(1, ...(start > 2 ? ["…"] : [])); for (let value = start; value <= end; value += 1) values.push(value); if (end < store.totalPages) values.push(...(end < store.totalPages - 1 ? ["…"] : []), store.totalPages); return values; });
async function applyRoute(): Promise<void> { syncingRoute.value = true; const filters = parseUsageRouteQuery(route.query); store.fromDate = filters.fromDate; store.toDate = filters.toDate; store.sourceFilter = filters.source ?? ""; store.modelFilter = filters.model ?? ""; store.projectFilter = filters.projectKey ?? ""; store.sessionFilter = filters.sessionId ?? ""; store.page = 1; await store.loadPage({ source: filters.source, model: filters.model, projectKey: filters.projectKey, sessionId: filters.sessionId, from: filters.from, to: filters.to }); syncingRoute.value = false; }
function replaceFromForm(): void { if (syncingRoute.value) return; void router.replace({ path: "/usage", query: buildUsageRouteQuery({ preset: "custom", fromDate: store.fromDate, toDate: store.toDate, source: store.sourceFilter || undefined, model: store.modelFilter || undefined, projectKey: store.projectFilter || undefined, sessionId: store.sessionFilter || undefined }) }); }
function selectPreset(preset: UsageDatePreset): void { void router.replace({ path: "/usage", query: buildUsageRouteQuery({ preset }) }); }
function openSession(record: UsageRecord): void { if (record.sessionId) void router.push({ path: "/sessions", query: { source: record.source, session: record.sessionId } }); }
async function exportCsv(): Promise<void> { const records = await store.filteredRecords(); const csv = usageRecordsToCsv(records, projects.nameFor); const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `lw-aiusage-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url); }
watch(() => route.fullPath, () => { void applyRoute(); }, { immediate: true });
watch([() => store.fromDate, () => store.toDate, () => store.sourceFilter, () => store.modelFilter, () => store.projectFilter, () => store.sessionFilter], replaceFromForm);
</script>
<template>
  <section class="page">
    <div class="page-heading"><div><h2>{{ t("usage.title") }}</h2><p>{{ t("usage.description") }}</p></div><button class="secondary-action" @click="exportCsv">{{ t("usage.exportCsv") }}</button></div>
    <article class="panel preset-panel"><span class="preset-caption">{{ t("filter.presets") }}</span><div class="preset-list"><button v-for="preset in presets" :key="preset" :class="{ active: parseUsageRouteQuery(route.query).preset === preset }" @click="selectPreset(preset)">{{ presetLabel(preset) }}</button></div></article>
    <article class="panel filter-panel"><div class="filter-field"><label>{{ t("filter.from") }}</label><input v-model="store.fromDate" type="date" /></div><div class="filter-field"><label>{{ t("filter.to") }}</label><input v-model="store.toDate" type="date" /></div><div class="filter-field"><label>{{ t("filter.agent") }}</label><select v-model="store.sourceFilter"><option value="">{{ t("filter.allAgents") }}</option><option value="codex">Codex</option><option value="claude">Claude Code</option></select></div><div class="filter-field"><label>{{ t("filter.model") }}</label><select v-model="store.modelFilter"><option value="">{{ t("filter.allModels") }}</option><option v-for="model in store.modelOptions" :key="model" :value="model">{{ model }}</option></select></div><div class="filter-field"><label>{{ t("filter.project") }}</label><select v-model="store.projectFilter"><option value="">{{ t("filter.allProjects") }}</option><option v-for="project in store.projectOptions" :key="project.key" :value="project.key">{{ project.name }}</option></select></div><button class="clear-button" @click="store.clearFilters">{{ t("filter.clear") }}</button></article>
    <article class="panel table-panel" :class="{ 'is-loading': store.loading }"><table><thead><tr><th>{{ t("usage.time") }}</th><th>{{ t("filter.agent") }}</th><th>{{ t("filter.model") }}</th><th>{{ t("filter.project") }}</th><th>{{ t("usage.input") }}</th><th>{{ t("usage.cached") }}</th><th>{{ t("usage.output") }}</th><th>{{ t("usage.total") }}</th><th>{{ t("sessions.title") }}</th></tr></thead><tbody><tr v-for="record in store.items" :key="record.id" class="usage-row" @click="selectedRecord = record"><td>{{ dateTime(record.timestamp) }}</td><td><span class="source-badge">{{ record.source }}</span></td><td>{{ record.model }}</td><td>{{ projects.nameFor(record.projectKey) }}</td><td>{{ format(record.usage.inputTokens) }}</td><td>{{ format(record.usage.cachedInputTokens) }}</td><td>{{ format(record.usage.outputTokens) }}</td><td><strong>{{ format(totalTokens(record.usage)) }}</strong></td><td><button v-if="record.sessionId" class="text-action" @click.stop="openSession(record)">{{ t("usage.open") }}</button><span v-else>—</span></td></tr><tr v-if="!store.items.length"><td colspan="9" class="empty-cell">{{ t("usage.empty") }}</td></tr></tbody></table><div class="table-footer"><span>{{ store.total }} {{ t("usage.recordsCount") }}</span><label>{{ t("usage.pageSize") }} <select :value="store.pageSize" @change="store.setPageSize(Number(($event.target as HTMLSelectElement).value))"><option v-for="size in store.pageSizeOptions" :key="size" :value="size">{{ size }}</option></select></label><div class="pagination"><button :disabled="store.page <= 1" @click="store.setPage(store.page - 1)">‹</button><template v-for="(item, index) in pages" :key="`${item}-${index}`"><span v-if="item === '…'" class="page-ellipsis">…</span><button v-else :class="{ active: item === store.page }" @click="store.setPage(item)">{{ item }}</button></template><button :disabled="store.page >= store.totalPages" @click="store.setPage(store.page + 1)">›</button></div></div></article>
    <UsageDetailDrawer v-if="selectedRecord" :record="selectedRecord" :project-name="projects.nameFor" @close="selectedRecord = undefined" @view-session="openSession(selectedRecord); selectedRecord = undefined" />
  </section>
</template>
