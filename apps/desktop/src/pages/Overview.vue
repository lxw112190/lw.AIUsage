<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { use, init, type ECharts } from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useOverviewStore } from "../stores/overview";
import { useUsageStore } from "../stores/usage";
import { useI18n } from "../i18n";
import { formatTokenAmount } from "../format";

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
const store = useOverviewStore();
const runtime = useUsageStore();
const { t, locale } = useI18n();
const chartElement = ref<HTMLElement>();
let chart: ECharts | undefined;
const format = (value: number): string => formatTokenAmount(value);
const trend = computed(() => store.data.trend.map((item) => [
  new Date(item.timestamp).toLocaleDateString(locale.value === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric" }),
  item.totalTokens,
] as [string, number]));
function renderChart(): void {
  if (!chartElement.value) return;
  chart ??= init(chartElement.value);
  chart.setOption({
    grid: { left: 8, right: 12, top: 18, bottom: 22, containLabel: true },
    tooltip: { trigger: "axis", valueFormatter: (value: number | string) => formatTokenAmount(Number(value)) },
    xAxis: { type: "category", data: trend.value.map(([key]) => key), axisLine: { lineStyle: { color: "#dfe3ea" } } },
    yAxis: { type: "value", axisLabel: { formatter: (value: number) => formatTokenAmount(value) }, splitLine: { lineStyle: { color: "#eef0f4" } } },
    series: [{ type: "line", smooth: true, data: trend.value.map(([, value]) => value), symbol: "circle", symbolSize: 7, lineStyle: { width: 3, color: "#6957e8" }, itemStyle: { color: "#6957e8" }, areaStyle: { color: "rgba(105,87,232,.16)" } }],
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
      <article class="stat-card"><span class="stat-label">{{ t("overview.usageRecords") }}</span><strong>{{ store.data.records }}</strong><span class="stat-meta">{{ t("overview.dedup") }}</span></article>
      <article class="stat-card"><span class="stat-label">{{ t("overview.activeAgents") }}</span><strong>{{ Object.keys(store.data.bySource).length }}</strong><span class="stat-meta">{{ t("overview.codexClaude") }}</span></article>
      <article class="stat-card"><span class="stat-label">{{ t("overview.estimatedCost") }}</span><strong>${{ store.data.estimatedCostUsd.toFixed(2) }}</strong><span class="stat-meta">{{ t("overview.publicRates") }}</span></article>
    </div>
    <div class="content-grid">
      <article class="panel chart-panel"><div class="panel-heading"><div><h2>{{ t("overview.tokenTrend") }}</h2><p>{{ t("overview.dailyUsage") }}</p></div><span class="range-pill">{{ t("overview.allTime") }}</span></div><div ref="chartElement" class="chart"></div><div v-if="!trend.length" class="empty-overlay">{{ t("overview.emptyTrend") }}</div></article>
      <article class="panel"><div class="panel-heading"><div><h2>{{ t("overview.agentBreakdown") }}</h2><p>{{ t("overview.tokensBySource") }}</p></div></div><div v-if="Object.keys(store.data.bySource).length" class="breakdown"><div v-for="(value, key) in store.data.bySource" :key="key" class="breakdown-row"><div><span class="agent-icon">{{ key === "codex" ? "C" : "A" }}</span><span>{{ key }}</span></div><strong>{{ format(value) }}</strong></div></div><div v-else class="empty-state">{{ t("overview.noAgentData") }}</div></article>
    </div>
  </section>
</template>
