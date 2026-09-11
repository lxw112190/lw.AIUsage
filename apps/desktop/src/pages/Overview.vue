<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { use, init, type ECharts } from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useOverviewStore } from "../stores/overview";
import { useUsageStore } from "../stores/usage";
import { useSettingsStore } from "../stores/settings";
import { useI18n } from "../i18n";
import { useRouter } from "vue-router";
import { localDateKey } from "../usageRoute";
import { formatTokenAmount, formatTokenDetail } from "../format";
import type { ActivityCell, ActivityGranularity } from "@lw-aiusage/application";
import type { PeriodComparison } from "@lw-aiusage/application";
import { useChangeDriversStore } from "../stores/changeDrivers";
import type { ChangeDimension, ComparisonPeriod } from "@lw-aiusage/application";

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
const store = useOverviewStore();
const runtime = useUsageStore();
const settings = useSettingsStore();
const { t, locale } = useI18n();
const router = useRouter();
const drivers = useChangeDriversStore();
const driverPeriod = ref<ComparisonPeriod>("today");
const driverDimension = ref<ChangeDimension>("project");
const chartElement = ref<HTMLElement>();
let chart: ECharts | undefined;
const format = (value: number): string => formatTokenAmount(value, { locale: locale.value });
const healthState = computed(() => {
  if (runtime.syncing) return "syncing";
  if (runtime.error) return "error";
  if (runtime.lastSyncResult?.diagnostics.length) return "warning";
  if (runtime.lastSync) return "healthy";
  return "pending";
});
const lastSyncText = computed(() => runtime.lastSync
  ? new Date(runtime.lastSync).toLocaleString(locale.value === "zh" ? "zh-CN" : "en-US")
  : t("overview.neverSynced"));
const periodLabel = (period: PeriodComparison["period"]): string => t(`overview.period.${period}`);
const comparisonText = (period: PeriodComparison): string => {
  if (period.previousTokens === 0 && period.currentTokens > 0) return t("overview.newActivity");
  if (period.changePercent === undefined || period.changePercent === 0) return "—";
  const sign = period.changePercent > 0 ? "+" : "";
  return `${sign}${period.changePercent.toFixed(1)}%`;
};
function openPeriod(period: PeriodComparison["period"]): void { void router.push({ path: "/usage", query: { preset: period === "today" ? "today" : period === "week" ? "thisWeek" : "thisMonth" } }); }
function openAgent(source: string): void { void router.push({ path: "/usage", query: { source } }); }
const driverTabs: Array<{ value: ChangeDimension; label: string }> = [{ value: "project", label: "overview.driversProjects" }, { value: "model", label: "overview.driversModels" }, { value: "source", label: "overview.driversAgents" }];
const driverPeriodTabs: Array<{ value: ComparisonPeriod; label: string }> = [{ value: "today", label: "overview.period.today" }, { value: "week", label: "overview.period.week" }, { value: "month", label: "overview.period.month" }];
const currentDrivers = computed(() => { const result = drivers.data; if (!result) return []; return driverDimension.value === "project" ? result.byProject : driverDimension.value === "model" ? result.byModel : result.bySource; });
const driverDelta = (value: number): string => `${value > 0 ? "+" : ""}${format(value)}`;
function loadDrivers(period: ComparisonPeriod): void { driverPeriod.value = period; void drivers.load(period); }
function openDriver(key: string): void { if (!drivers.data) return; const query: Record<string, string> = { from: localDateKey(drivers.data.from), to: localDateKey(drivers.data.to - 1), preset: "custom" }; if (driverDimension.value === "project") query.project = key; if (driverDimension.value === "model") query.model = key; if (driverDimension.value === "source") query.source = key; void router.push({ path: "/usage", query }); }
const trendModes: Array<{ value: ActivityGranularity; label: string }> = [
  { value: "daily", label: "overview.trendDaily" },
  { value: "weekly", label: "overview.trendWeekly" },
  { value: "monthly", label: "overview.trendMonthly" },
  { value: "cumulative", label: "overview.trendCumulative" },
];
interface TrendPoint { label: string; value: number; cell: ActivityCell; }
function formatTrendLabel(cell: ActivityCell, granularity: ActivityGranularity): string {
  const options = granularity === "monthly" || (granularity === "cumulative" && (store.activityData?.cells.length ?? 0) > 730)
    ? { year: "numeric", month: "short" }
    : { month: "short", day: "numeric" };
  return new Date(cell.start).toLocaleDateString(locale.value === "zh" ? "zh-CN" : "en-US", options);
}
const trend = computed<TrendPoint[]>(() => (store.activityData?.cells ?? []).map((cell) => ({
  label: formatTrendLabel(cell, settings.activityGranularity),
  value: cell.cumulativeTokens ?? cell.totalTokens,
  cell,
})));
function formatTrendTooltipTitle(cell: ActivityCell, granularity: ActivityGranularity): string {
  const language = locale.value === "zh" ? "zh-CN" : "en-US";
  if (granularity === "weekly") {
    const start = new Date(cell.start).toLocaleDateString(language, { year: "numeric", month: "short", day: "numeric" });
    const end = new Date(cell.end - 1).toLocaleDateString(language, { month: "short", day: "numeric" });
    return `${start} - ${end}`;
  }
  return new Date(cell.start).toLocaleDateString(language, granularity === "monthly" ? { year: "numeric", month: "long" } : { year: "numeric", month: "long", day: "numeric" });
}
function formatTrendTooltip(params: unknown): string {
  const item = Array.isArray(params) ? params[0] : params;
  if (!item || typeof item !== "object" || !("dataIndex" in item)) return "";
  const index = Number(item.dataIndex);
  const point = trend.value[index];
  if (!point) return "";
  const granularity = settings.activityGranularity;
  const lines = [`<strong>${formatTrendTooltipTitle(point.cell, granularity)}</strong>`];
  if (granularity === "cumulative") {
    lines.push(`${t("overview.trendAdded")}: ${formatTokenDetail(point.cell.totalTokens, locale.value)}`);
    lines.push(`${t("overview.trendCumulativeValue")}: ${formatTokenDetail(point.cell.cumulativeTokens ?? point.value, locale.value)}`);
  } else {
    lines.push(`${t("overview.trendTokenValue")}: ${formatTokenDetail(point.cell.totalTokens, locale.value)}`);
    if (point.cell.activeDays !== undefined) lines.push(`${t("overview.trendActiveDays")}: ${point.cell.activeDays}`);
  }
  return lines.join("<br />");
}
function changeTrend(value: ActivityGranularity): void { settings.setActivityGranularity(value); }
void store.loadActivity(settings.activityGranularity);
void drivers.load(driverPeriod.value);
watch(() => settings.activityGranularity, (value) => { void store.loadActivity(value); });
function renderChart(): void {
  if (!chartElement.value) return;
  chart ??= init(chartElement.value);
  chart.setOption({
    grid: { left: 8, right: 12, top: 18, bottom: 22, containLabel: true },
    tooltip: { trigger: "axis", formatter: formatTrendTooltip },
    xAxis: { type: "category", data: trend.value.map((point) => point.label), axisLabel: { hideOverlap: true }, axisLine: { lineStyle: { color: "#dfe3ea" } } },
    yAxis: { type: "value", axisLabel: { formatter: (value: number) => formatTokenAmount(value, { locale: locale.value, decimals: 1 }) }, splitLine: { lineStyle: { color: "#eef0f4" } } },
    series: [{ type: "line", smooth: settings.activityGranularity === "cumulative", showSymbol: !["daily", "cumulative"].includes(settings.activityGranularity), data: trend.value.map((point) => point.value), symbol: "circle", symbolSize: 6, lineStyle: { width: 3, color: "#6957e8" }, itemStyle: { color: "#6957e8" }, areaStyle: settings.activityGranularity === "cumulative" ? { color: "rgba(105,87,232,.16)" } : undefined }],
  });
  chart.off("click");
  chart.on("click", (params) => {
    if (!params || typeof params !== "object" || !("dataIndex" in params)) return;
    const index = Number(params.dataIndex);
    const point = trend.value[index];
    if (!point) return;
    void router.push({ path: "/usage", query: { from: localDateKey(point.cell.start), to: localDateKey(point.cell.end - 1), preset: "custom" } });
  });
}
function resizeChart(): void { chart?.resize(); }
onMounted(() => { void nextTick(renderChart); window.addEventListener("resize", resizeChart); });
onUnmounted(() => { chart?.dispose(); window.removeEventListener("resize", resizeChart); });
watch(trend, () => { void nextTick(renderChart); });
</script>

<template>
  <section class="page">
    <article v-if="!store.data.records && !runtime.syncing" class="welcome-card"><div class="welcome-icon">✦</div><div><h2>{{ t("overview.welcomeTitle") }}</h2><p>{{ t("overview.welcomeText") }}</p></div><button class="sync-button" @click="runtime.sync">{{ t("overview.scan") }}</button></article>
    <article class="panel health-panel" :class="`health-${healthState}`">
      <div class="health-main"><span class="health-indicator"></span><div><strong>{{ t(`overview.health.${healthState}`) }}</strong><p>{{ t("overview.lastSync") }}：{{ lastSyncText }}</p></div></div>
      <div v-if="runtime.syncing && runtime.syncProgress" class="sync-progress"><div class="sync-progress-label"><span>{{ runtime.syncProgress.source }}</span><span>{{ runtime.syncProgress.current }} / {{ runtime.syncProgress.total }}</span></div><div class="progress-track"><span :style="{ width: `${runtime.syncProgress.total ? runtime.syncProgress.current / runtime.syncProgress.total * 100 : 0}%` }"></span></div></div>
      <div v-else class="health-meta"><span>{{ t("overview.filesScanned") }} <strong>{{ runtime.lastSyncResult?.files ?? 0 }}</strong></span><span>{{ t("overview.recordsChanged") }} <strong>{{ runtime.lastSyncResult?.changedRecords ?? 0 }}</strong></span><span>Codex Parser <strong>V{{ runtime.collectorVersions.codex }}</strong></span></div>
    </article>
    <div class="stats-grid">
      <article class="stat-card primary"><span class="stat-label">{{ t("overview.totalTokens") }}</span><strong>{{ format(store.data.totalTokens) }}</strong><span class="stat-meta">{{ t("overview.allRecords") }} · {{ t("overview.cachedShare") }} {{ store.data.cachedInputShare === undefined ? "—" : `${(store.data.cachedInputShare * 100).toFixed(1)}%` }}</span></article>
      <article class="stat-card"><span class="stat-label">{{ t("overview.usageRecords") }}</span><strong>{{ store.data.records.toLocaleString(locale === "zh" ? "zh-CN" : "en-US") }}</strong><span class="stat-meta">{{ t("overview.dedup") }}</span></article>
      <article class="stat-card"><span class="stat-label">{{ t("overview.activeAgents") }}</span><strong>{{ Object.keys(store.data.bySource).length }}</strong><span class="stat-meta">{{ t("overview.codexClaude") }}</span></article>
      <article class="stat-card"><span class="stat-label">{{ t("overview.estimatedCost") }}</span><strong>${{ store.data.estimatedCostUsd.toFixed(2) }}</strong><span class="stat-meta">{{ t("overview.pricingCoverage") }} {{ (store.data.pricingCoverage.coverageRatio * 100).toFixed(1) }}%</span></article>
    </div>
    <div class="period-grid">
      <article v-for="period in store.data.periods" :key="period.period" class="period-card clickable-card" @click="openPeriod(period.period)"><span>{{ periodLabel(period.period) }}</span><strong>{{ format(period.currentTokens) }}</strong><div><small>{{ t("overview.previousComparable") }} {{ format(period.previousTokens) }}</small><em :class="{ positive: period.deltaTokens > 0, negative: period.deltaTokens < 0 }">{{ comparisonText(period) }}</em></div></article>
    </div>
    <div class="content-grid">
      <article class="panel chart-panel"><div class="panel-heading trend-heading"><div><h2>{{ t("overview.tokenTrend") }}</h2><p>{{ t("overview.tokenTrendDescription") }}</p></div><div class="trend-modes"><button v-for="mode in trendModes" :key="mode.value" :class="{ active: settings.activityGranularity === mode.value }" @click="changeTrend(mode.value)">{{ t(mode.label) }}</button></div></div><div ref="chartElement" class="chart"></div><div v-if="!store.data.records" class="empty-overlay">{{ t("overview.emptyTrend") }}</div></article>
      <article class="panel"><div class="panel-heading"><div><h2>{{ t("overview.agentBreakdown") }}</h2><p>{{ t("overview.tokensBySource") }}</p></div></div><div v-if="Object.keys(store.data.bySource).length" class="breakdown"><div v-for="(value, key) in store.data.bySource" :key="key" class="breakdown-row clickable-card" @click="openAgent(key)"><div><span class="agent-icon">{{ key === "codex" ? "C" : "A" }}</span><span>{{ key }}</span></div><strong>{{ format(value) }}</strong></div></div><div v-else class="empty-state">{{ t("overview.noAgentData") }}</div></article>
    </div>
    <article class="panel change-drivers-panel"><div class="panel-heading"><div><h2>{{ t("overview.changeDrivers") }}</h2><p>{{ t("overview.changeDriversDescription") }}</p></div><div class="trend-modes"><button v-for="period in driverPeriodTabs" :key="period.value" :class="{ active: driverPeriod === period.value }" @click="loadDrivers(period.value)">{{ t(period.label) }}</button></div></div><div class="driver-toolbar"><button v-for="tab in driverTabs" :key="tab.value" :class="{ active: driverDimension === tab.value }" @click="driverDimension = tab.value">{{ t(tab.label) }}</button></div><div v-if="drivers.loading" class="empty-state">{{ t("overview.loadingDrivers") }}</div><div v-else-if="!currentDrivers.length" class="empty-state">{{ t("overview.noDriverData") }}</div><div v-else class="driver-list"><div v-for="item in currentDrivers.slice(0, 6)" :key="item.key" class="driver-row clickable-card" @click="openDriver(item.key)"><div><strong>{{ item.key }}</strong><small>{{ t(`overview.driver.${item.state}`) }}</small></div><div><strong :class="{ positive: item.deltaTokens > 0, negative: item.deltaTokens < 0 }">{{ driverDelta(item.deltaTokens) }}</strong><small>{{ item.changePercent === undefined ? "—" : `${item.changePercent > 0 ? '+' : ''}${item.changePercent.toFixed(1)}%` }}</small></div></div></div></article>
  </section>
</template>
