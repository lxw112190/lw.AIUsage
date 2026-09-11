<script setup lang="ts">
import type { SessionDetailData } from "@lw-aiusage/application";
import { totalTokens } from "@lw-aiusage/core";
import { formatTokenDetail } from "../format";
import { useI18n } from "../i18n";
defineProps<{ detail: SessionDetailData }>();
const emit = defineEmits<{ close: []; viewUsage: [] }>();
const { t, locale } = useI18n();
</script>
<template>
  <div class="drawer-backdrop" @click.self="emit('close')"><aside class="detail-drawer session-drawer"><div class="drawer-heading"><div><p class="eyebrow">{{ t("sessions.detailEyebrow") }}</p><h2>{{ detail.summary.sessionId }}</h2></div><button class="drawer-close" @click="emit('close')">×</button></div><div class="drawer-summary"><span class="source-badge">{{ detail.summary.source }}</span><span>{{ detail.summary.primaryModel }}</span><span>{{ detail.summary.recordCount }} {{ t("usage.recordsCount") }}</span></div><div class="session-kpis"><div><span>{{ t("usage.total") }}</span><strong>{{ formatTokenDetail(detail.summary.totalTokens, locale) }}</strong></div><div><span>{{ t("sessions.span") }}</span><strong>{{ Math.round(detail.summary.spanMs / 60000) }} min</strong></div><div><span>{{ t("sessions.projects") }}</span><strong>{{ detail.summary.projects.length }}</strong></div></div><h3>{{ t("sessions.timeline") }}</h3><div class="session-timeline"><div v-for="point in detail.timeline" :key="point.start" class="timeline-row"><time>{{ new Date(point.start).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" }) }}</time><div class="timeline-track"><span :style="{ width: `${Math.max(4, Math.min(100, point.totalTokens / Math.max(detail.summary.totalTokens, 1) * 100))}%` }"></span></div><strong>{{ formatTokenDetail(totalTokens(point.usage), locale) }}</strong></div></div><button class="secondary-action drawer-session-action" @click="emit('viewUsage')">{{ t("sessions.viewRecords") }}</button></aside></div>
</template>
