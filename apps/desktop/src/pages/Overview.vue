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
import { formatTokenAmount, formatTokenDetail } from "../format";
import type { ActivityCell, ActivityGranularity } from "@lw-aiusage/application";

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
const store = useOverviewStore();
const runtime = useUsageStore();
const settings = useSettingsStore();
const { t, locale } = useI18n();
const chartElement = ref<HTMLElement>();
let chart: ECharts | undefined;
const format = (value: number): string => formatTokenAmount(value, { locale: locale.value });
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
}
function resizeChart(): void { chart?.resize(); }
onMounted(() => { void nextTick(renderChart); window.addEventListener("resize", resizeChart); });
onUnmounted(() => { chart?.dispose(); window.removeEventListener("resize", resizeChart); });
watch(trend, () => { void nextTick(renderChart); });
</script>

<template>
  <section class="page">
    <article v-if="!store.data.records && !runtime.syncing" class="welcome-card"><div class="welcome-icon">✦</div><div><h2>{{ t("overview.welcomeTitle") }}</h2><p>{{ t("overview.welcomeText") }}</p></div><button class="sync-button" @click="runtime.sync">{{ t("overview.scan") }}</button></article>
    <div class="stats-grid">
      <article class="stat-card primary"><span class="stat-label">{{ t("overview.totalTokens") }}</span><strong>{{ format(store.data.totalTokens) }}</strong><span class="stat-meta">{{ t("overview.allRecords") }}</span></article>
      <article class="stat-card"><span class="stat-label">{{ t("overview.usageRecords") }}</span><strong>{{ store.data.records.toLocaleString(locale === "zh" ? "zh-CN" : "en-US") }}</strong><span class="stat-meta">{{ t("overview.dedup") }}</span></article>
      <article class="stat-card"><span class="stat-label">{{ t("overview.activeAgents") }}</span><strong>{{ Object.keys(store.data.bySource).length }}</strong><span class="stat-meta">{{ t("overview.codexClaude") }}</span></article>
      <article class="stat-card"><span class="stat-label">{{ t("overview.estimatedCost") }}</span><strong>${{ store.data.estimatedCostUsd.toFixed(2) }}</strong><span class="stat-meta">{{ t("overview.publicRates") }}</span></article>
    </div>
    <div class="content-grid">
      <article class="panel chart-panel"><div class="panel-heading trend-heading"><div><h2>{{ t("overview.tokenTrend") }}</h2><p>{{ t("overview.tokenTrendDescription") }}</p></div><div class="trend-modes"><button v-for="mode in trendModes" :key="mode.value" :class="{ active: settings.activityGranularity === mode.value }" @click="changeTrend(mode.value)">{{ t(mode.label) }}</button></div></div><div ref="chartElement" class="chart"></div><div v-if="!store.data.records" class="empty-overlay">{{ t("overview.emptyTrend") }}</div></article>
      <article class="panel"><div class="panel-heading"><div><h2>{{ t("overview.agentBreakdown") }}</h2><p>{{ t("overview.tokensBySource") }}</p></div></div><div v-if="Object.keys(store.data.bySource).length" class="breakdown"><div v-for="(value, key) in store.data.bySource" :key="key" class="breakdown-row"><div><span class="agent-icon">{{ key === "codex" ? "C" : "A" }}</span><span>{{ key }}</span></div><strong>{{ format(value) }}</strong></div></div><div v-else class="empty-state">{{ t("overview.noAgentData") }}</div></article>
    </div>
  </section>
</template>
