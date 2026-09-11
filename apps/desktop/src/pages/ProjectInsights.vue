<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { use, init, type ECharts } from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useProjectInsightsStore } from "../stores/projectInsights";
import { useProjectPreferencesStore } from "../stores/projects";
import { useI18n } from "../i18n";
import { formatTokenAmount, formatTokenDetail } from "../format";

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
const store = useProjectInsightsStore();
const projects = useProjectPreferencesStore();
const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const range = ref<"last30" | "last90" | "all">("last30");
const chartElement = ref<HTMLElement>();
let chart: ECharts | undefined;
const projectKey = computed(() => typeof route.query.key === "string" ? route.query.key : "");
const format = (value: number): string => formatTokenAmount(value, { locale: locale.value, withUnitSuffix: true });
const money = (value: number): string => `$${value.toFixed(2)}`;
const coverageLabel = computed(() => {
  const value = store.data?.range.pricing;
  if (!value) return "—";
  if (value.unmatchedTokens > 0) return `${t("pricing.incomplete")} ${(value.coverageRatio * 100).toFixed(1)}%`;
  if (value.fallbackTokens > 0) return t("pricing.approximate");
  return t("pricing.exact");
});
async function load(): Promise<void> { if (projectKey.value) await store.load(projectKey.value, range.value); }
function openUsage(extra: Record<string, string> = {}): void { void router.push({ path: "/usage", query: { project: projectKey.value, ...extra } }); }
function openSessions(): void { void router.push({ path: "/sessions", query: { project: projectKey.value } }); }
function setRange(value: string): void { if (value === "last30" || value === "last90" || value === "all") range.value = value; }
function renderChart(): void {
  if (!chartElement.value || !store.data) return;
  chart ??= init(chartElement.value);
  const points = store.data.range.trend;
  chart.setOption({
    grid: { left: 8, right: 12, top: 12, bottom: 22, containLabel: true },
    tooltip: { trigger: "axis", formatter: (params: unknown) => { const item = Array.isArray(params) ? params[0] : params; if (!item || typeof item !== "object" || !("dataIndex" in item)) return ""; const point = points[Number(item.dataIndex)]; return point ? `${point.day}<br/><strong>${formatTokenDetail(point.totalTokens, locale.value)}</strong>` : ""; } },
    xAxis: { type: "category", data: points.map((point) => point.day.slice(5)), axisLabel: { hideOverlap: true } },
    yAxis: { type: "value", axisLabel: { formatter: (value: number) => formatTokenAmount(value, { locale: locale.value, decimals: 1 }) } },
    series: [{ type: "line", smooth: true, showSymbol: false, data: points.map((point) => point.totalTokens), lineStyle: { width: 3, color: "#6957e8" }, areaStyle: { color: "rgba(105,87,232,.14)" } }],
  });
  chart.off("click");
  chart.on("click", (params) => { if (!params || typeof params !== "object" || !("dataIndex" in params)) return; const point = points[Number(params.dataIndex)]; if (point) openUsage({ from: point.day, to: point.day, preset: "custom" }); });
}
function resizeChart(): void { chart?.resize(); }
watch(() => route.fullPath, () => { void load(); });
watch(range, () => { void load(); });
watch(() => store.data?.range.trend, () => { void nextTick(renderChart); });
void projects.load();
void load();
onMounted(() => { void nextTick(renderChart); window.addEventListener("resize", resizeChart); });
onUnmounted(() => { chart?.dispose(); window.removeEventListener("resize", resizeChart); });
</script>
<template>
  <section class="page">
    <div class="page-heading">
      <div><button class="text-action" @click="router.push('/stats')">← {{ t("project.backToProjects") }}</button><h2>{{ projectKey ? projects.nameFor(projectKey) : t("project.title") }}</h2><p class="project-raw-key">{{ projectKey }}</p></div>
      <div class="project-range-tabs"><button v-for="value in ['last30', 'last90', 'all']" :key="value" :class="{ active: range === value }" @click="setRange(value)">{{ t(`project.range.${value}`) }}</button></div>
    </div>
    <div v-if="store.refreshing" class="refresh-hint">{{ t("project.refreshing") }}</div>
    <div v-if="store.loading" class="panel empty-state">{{ t("project.loading") }}</div>
    <div v-else-if="!store.data" class="panel empty-state">{{ t("project.empty") }}</div>
    <template v-else>
      <div class="project-summary-grid">
        <article class="stat-card primary"><span class="stat-label">{{ t("overview.totalTokens") }}</span><strong>{{ format(store.data.allTime.totalTokens) }}</strong><span class="stat-meta">{{ t("overview.cachedShare") }} {{ store.data.range.cachedInputShare === undefined ? "—" : `${(store.data.range.cachedInputShare * 100).toFixed(1)}%` }}</span></article>
        <article class="stat-card"><span class="stat-label">{{ t("project.selectedRange") }}</span><strong>{{ format(store.data.range.totalTokens) }}</strong><span class="stat-meta">{{ store.data.range.comparison?.changePercent === undefined ? "—" : `${store.data.range.comparison.changePercent > 0 ? '+' : ''}${store.data.range.comparison.changePercent.toFixed(1)}%` }}</span></article>
        <article class="stat-card"><span class="stat-label">{{ t("project.records") }}</span><strong>{{ store.data.allTime.recordCount.toLocaleString() }}</strong><span class="stat-meta">{{ store.data.allTime.sessionCount }} {{ t("sessions.title") }} · {{ store.data.range.recordCount.toLocaleString() }} {{ t("project.rangeRecords") }}</span></article>
        <article class="stat-card"><span class="stat-label">{{ t("project.cost") }}</span><strong>{{ money(store.data.range.pricing.estimatedCostUsd) }}</strong><span class="stat-meta">{{ coverageLabel }}</span></article>
      </div>
      <div class="content-grid">
        <article class="panel chart-panel"><div class="panel-heading"><div><h2>{{ t("project.trend") }}</h2><p>{{ t("project.trendDescription") }}</p></div></div><div ref="chartElement" class="chart"></div></article>
        <article class="panel"><div class="panel-heading"><div><h2>{{ t("project.agents") }}</h2><p>{{ t("project.breakdownDescription") }}</p></div></div><div class="breakdown"><div v-for="item in store.data.range.bySource" :key="item.key" class="breakdown-row clickable-card" @click="openUsage({ source: item.key })"><div><span class="agent-icon">{{ item.key === 'codex' ? 'C' : 'A' }}</span><span>{{ item.key }}</span></div><strong>{{ (item.share * 100).toFixed(1) }}%</strong></div></div></article>
      </div>
      <div class="content-grid">
        <article class="panel"><div class="panel-heading"><div><h2>{{ t("project.models") }}</h2></div></div><div class="breakdown"><div v-for="item in store.data.range.byModel.slice(0, 8)" :key="item.key" class="breakdown-row clickable-card" @click="openUsage({ model: item.key })"><div><span>{{ item.key }}</span></div><strong>{{ (item.share * 100).toFixed(1) }}%</strong></div></div></article>
        <article class="panel"><div class="panel-heading"><div><h2>{{ t("project.topSessions") }}</h2></div></div><div class="breakdown"><div v-for="item in store.data.range.topSessions" :key="item.key" class="breakdown-row clickable-card" @click="router.push({ path: '/sessions', query: { source: item.source, session: item.sessionId } })"><div><span :title="item.sessionId">{{ item.sessionId }}</span></div><strong>{{ format(item.totalTokens) }}</strong></div></div></article>
      </div>
      <div class="project-actions"><button class="secondary-action" @click="openUsage()">{{ t("project.viewUsage") }}</button><button class="secondary-action" @click="openSessions">{{ t("project.viewSessions") }}</button></div>
    </template>
  </section>
</template>
