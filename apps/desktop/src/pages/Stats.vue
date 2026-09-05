<script setup lang="ts">
import { useStatsStore } from "../stores/stats";
import { projectDisplayName } from "@lw-aiusage/core";
import { useI18n } from "../i18n";
import { formatTokenAmount } from "../format";

const store = useStatsStore();
const { t, locale } = useI18n();
const format = (value: number): string => formatTokenAmount(value);
const money = (value: number): string => `$${value.toFixed(2)}`;
</script>

<template>
  <section class="page">
    <div class="page-heading"><div><h2>{{ t("stats.title") }}</h2><p>{{ t("stats.description") }}</p></div></div>
    <div class="stats-columns">
      <article class="panel"><div class="panel-heading"><div><h2>{{ t("stats.models") }}</h2><p>{{ t("stats.modelDistribution") }}</p></div></div><table class="compact-table"><thead><tr><th>{{ t("filter.model") }}</th><th>{{ t("stats.records") }}</th><th>{{ t("stats.tokens") }}</th><th>{{ t("stats.cost") }}</th></tr></thead><tbody><tr v-for="item in store.data.byModel" :key="item.key"><td><strong>{{ item.key }}</strong></td><td>{{ item.recordCount }}</td><td>{{ format(item.totalTokens) }}</td><td>{{ money(item.estimatedCostUsd) }}</td></tr><tr v-if="!store.data.byModel.length"><td colspan="4" class="empty-cell">{{ t("stats.noModelData") }}</td></tr></tbody></table></article>
      <article class="panel"><div class="panel-heading"><div><h2>{{ t("stats.projects") }}</h2><p>{{ t("stats.projectDistribution") }}</p></div></div><table class="compact-table"><thead><tr><th>{{ t("filter.project") }}</th><th>{{ t("stats.records") }}</th><th>{{ t("stats.tokens") }}</th><th>{{ t("stats.cost") }}</th></tr></thead><tbody><tr v-for="item in store.data.byProject" :key="item.key"><td><strong>{{ projectDisplayName(item.key) }}</strong></td><td>{{ item.recordCount }}</td><td>{{ format(item.totalTokens) }}</td><td>{{ money(item.estimatedCostUsd) }}</td></tr><tr v-if="!store.data.byProject.length"><td colspan="4" class="empty-cell">{{ t("stats.noProjectData") }}</td></tr></tbody></table></article>
    </div>
  </section>
</template>
