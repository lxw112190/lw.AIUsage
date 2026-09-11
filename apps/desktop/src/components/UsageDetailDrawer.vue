<script setup lang="ts">
import { computed } from "vue";
import { cachedInputShare, inputContextTokens, totalTokens, type UsageRecord } from "@lw-aiusage/core";
import { formatTokenDetail } from "../format";
import { useI18n } from "../i18n";

const props = defineProps<{ record: UsageRecord; projectName: (key: string) => string }>();
const emit = defineEmits<{ close: []; viewSession: [] }>();
const { t, locale } = useI18n();
const token = (value: number): string => formatTokenDetail(value, locale.value);
const share = computed(() => cachedInputShare(props.record.usage));
</script>
<template>
  <div class="drawer-backdrop" @click.self="emit('close')">
    <aside class="detail-drawer">
      <div class="drawer-heading"><div><p class="eyebrow">{{ t("usage.detailEyebrow") }}</p><h2>{{ t("usage.detailTitle") }}</h2></div><button class="drawer-close" @click="emit('close')">×</button></div>
      <div class="drawer-summary"><strong>{{ props.record.model }}</strong><span class="source-badge">{{ props.record.source }}</span><span>{{ new Date(props.record.timestamp).toLocaleString(locale === "zh" ? "zh-CN" : "en-US") }}</span></div>
      <div class="token-breakdown"><div><span>{{ t("usage.input") }}</span><strong>{{ token(props.record.usage.inputTokens) }}</strong></div><div><span>{{ t("usage.cached") }}</span><strong>{{ token(props.record.usage.cachedInputTokens) }}</strong></div><div><span>{{ t("usage.cacheCreation") }}</span><strong>{{ token(props.record.usage.cacheCreationInputTokens) }}</strong></div><div><span>{{ t("usage.output") }}</span><strong>{{ token(props.record.usage.outputTokens) }}</strong></div><div><span>{{ t("usage.reasoning") }}</span><strong>{{ token(props.record.usage.reasoningOutputTokens) }}</strong></div></div>
      <div class="drawer-total"><span>{{ t("usage.total") }}</span><strong>{{ token(totalTokens(props.record.usage)) }}</strong></div>
      <dl class="technical-details"><div><dt>{{ t("usage.inputContext") }}</dt><dd>{{ token(inputContextTokens(props.record.usage)) }}</dd></div><div><dt>{{ t("usage.cachedShare") }}</dt><dd>{{ share === undefined ? "—" : `${(share * 100).toFixed(1)}%` }}</dd></div><div><dt>{{ t("filter.project") }}</dt><dd>{{ props.projectName(props.record.projectKey) }}</dd></div><div><dt>Session ID</dt><dd>{{ props.record.sessionId ?? "—" }}</dd></div><div><dt>ID</dt><dd>{{ props.record.id }}</dd></div></dl>
      <button v-if="props.record.sessionId" class="secondary-action drawer-session-action" @click="emit('viewSession')">{{ t("usage.viewSession") }}</button>
    </aside>
  </div>
</template>
