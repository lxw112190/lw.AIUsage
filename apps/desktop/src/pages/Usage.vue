<script setup lang="ts">
import { useUsageStore } from "../stores/usage";
import { projectDisplayName, totalTokens } from "@lw-aiusage/core";
import { useI18n } from "../i18n";

const store = useUsageStore();
const { t, locale } = useI18n();
const format = (value: number): string => value.toLocaleString(locale.value === "zh" ? "zh-CN" : "en-US");
const dateTime = (value: number): string => new Date(value).toLocaleString(locale.value === "zh" ? "zh-CN" : "en-US");
</script>

<template>
  <section class="page"><div class="page-heading"><div><h2>{{ t("usage.title") }}</h2><p>{{ t("usage.description") }}</p></div></div><article class="panel filter-panel"><div class="filter-field"><label>{{ t("filter.from") }}</label><input v-model="store.fromDate" type="date" /></div><div class="filter-field"><label>{{ t("filter.to") }}</label><input v-model="store.toDate" type="date" /></div><div class="filter-field"><label>{{ t("filter.agent") }}</label><select v-model="store.sourceFilter"><option value="">{{ t("filter.allAgents") }}</option><option value="codex">Codex</option><option value="claude">Claude Code</option></select></div><div class="filter-field"><label>{{ t("filter.model") }}</label><select v-model="store.modelFilter"><option value="">{{ t("filter.allModels") }}</option><option v-for="model in store.modelOptions" :key="model" :value="model">{{ model }}</option></select></div><div class="filter-field"><label>{{ t("filter.project") }}</label><select v-model="store.projectFilter"><option value="">{{ t("filter.allProjects") }}</option><option v-for="project in store.projectOptions" :key="project.key" :value="project.key">{{ project.name }}</option></select></div><button class="clear-button" @click="store.clearFilters">{{ t("filter.clear") }}</button></article><article class="panel table-panel"><table><thead><tr><th>{{ t("usage.time") }}</th><th>{{ t("filter.agent") }}</th><th>{{ t("filter.model") }}</th><th>{{ t("filter.project") }}</th><th>{{ t("usage.input") }}</th><th>{{ t("usage.cached") }}</th><th>{{ t("usage.output") }}</th><th>{{ t("usage.total") }}</th></tr></thead><tbody><tr v-for="record in store.filteredRecords" :key="record.id"><td>{{ dateTime(record.timestamp) }}</td><td><span class="source-badge">{{ record.source }}</span></td><td>{{ record.model }}</td><td>{{ projectDisplayName(record.projectKey) }}</td><td>{{ format(record.usage.inputTokens) }}</td><td>{{ format(record.usage.cachedInputTokens) }}</td><td>{{ format(record.usage.outputTokens) }}</td><td><strong>{{ format(totalTokens(record.usage)) }}</strong></td></tr><tr v-if="!store.filteredRecords.length"><td colspan="8" class="empty-cell">{{ t("usage.empty") }}</td></tr></tbody></table></article></section>
</template>
