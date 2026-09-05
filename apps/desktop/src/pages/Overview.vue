<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import * as echarts from "echarts";
import { useUsageStore } from "../stores/usage";
import { useI18n } from "../i18n";
import { totalTokens } from "@lw-aiusage/core";

const store = useUsageStore();
const { t, locale } = useI18n();
const chartElement = ref<HTMLElement>();
let chart: echarts.ECharts | undefined;
const format = (value: number): string => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : String(value);
const trend = computed(() => { const grouped = new Map<string, number>(); for (const record of store.records) { const key = new Date(record.timestamp).toLocaleDateString(locale.value === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric" }); grouped.set(key, (grouped.get(key) ?? 0) + totalTokens(record.usage)); } return [...grouped.entries()]; });
function renderChart(): void { if (!chartElement.value) return; chart ??= echarts.init(chartElement.value); chart.setOption({ grid: { left: 8, right: 12, top: 18, bottom: 22, containLabel: true }, tooltip: { trigger: "axis" }, xAxis: { type: "category", data: trend.value.map(([key]) => key), axisLine: { lineStyle: { color: "#dfe3ea" } } }, yAxis: { type: "value", splitLine: { lineStyle: { color: "#eef0f4" } } }, series: [{ type: "line", smooth: true, data: trend.value.map(([, value]) => value), symbol: "circle", symbolSize: 7, lineStyle: { width: 3, color: "#6957e8" }, itemStyle: { color: "#6957e8" }, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(105,87,232,.22)" }, { offset: 1, color: "rgba(105,87,232,0)" }]) } }] }); }
onMounted(() => { void nextTick(renderChart); window.addEventListener("resize", renderChart); });
onUnmounted(() => { chart?.dispose(); window.removeEventListener("resize", renderChart); });
watch(trend, () => { void nextTick(renderChart); }, { deep: true });
</script>

<template>
  <section class="page">
    <article v-if="!store.records.length && !store.syncing" class="welcome-card"><div class="welcome-icon">✦</div><div><h2>{{ t("overview.welcomeTitle") }}</h2><p>{{ t("overview.welcomeText") }}</p></div><button class="sync-button" @click="store.sync">{{ t("overview.scan") }}</button></article>
    <div class="stats-grid"><article class="stat-card primary"><span class="stat-label">{{ t("overview.totalTokens") }}</span><strong>{{ format(store.total) }}</strong><span class="stat-meta">{{ t("overview.allRecords") }}</span></article><article class="stat-card"><span class="stat-label">{{ t("overview.usageRecords") }}</span><strong>{{ store.records.length }}</strong><span class="stat-meta">{{ t("overview.dedup") }}</span></article><article class="stat-card"><span class="stat-label">{{ t("overview.activeAgents") }}</span><strong>{{ Object.keys(store.byAgent).length || 0 }}</strong><span class="stat-meta">{{ t("overview.codexClaude") }}</span></article><article class="stat-card"><span class="stat-label">{{ t("overview.estimatedCost") }}</span><strong>${{ store.estimatedCost.toFixed(2) }}</strong><span class="stat-meta">{{ t("overview.publicRates") }}</span></article></div>
    <div class="content-grid"><article class="panel chart-panel"><div class="panel-heading"><div><h2>{{ t("overview.tokenTrend") }}</h2><p>{{ t("overview.dailyUsage") }}</p></div><span class="range-pill">{{ t("overview.allTime") }}</span></div><div ref="chartElement" class="chart"></div><div v-if="!trend.length" class="empty-overlay">{{ t("overview.emptyTrend") }}</div></article><article class="panel"><div class="panel-heading"><div><h2>{{ t("overview.agentBreakdown") }}</h2><p>{{ t("overview.tokensBySource") }}</p></div></div><div v-if="Object.keys(store.byAgent).length" class="breakdown"><div v-for="(value, key) in store.byAgent" :key="key" class="breakdown-row"><div><span class="agent-icon">{{ key === "codex" ? "C" : "A" }}</span><span>{{ key }}</span></div><strong>{{ format(value) }}</strong></div></div><div v-else class="empty-state">{{ t("overview.noAgentData") }}</div></article></div>
  </section>
</template>
