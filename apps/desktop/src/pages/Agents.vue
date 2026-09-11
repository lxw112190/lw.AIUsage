<script setup lang="ts">
import type { AgentSource } from "@lw-aiusage/core";
import { useUsageStore } from "../stores/usage";
import { useAgentsStore } from "../stores/agents";
import { useI18n } from "../i18n";
import { useRouter } from "vue-router";
import { formatTokenAmount } from "../format";
import { useSettingsStore } from "../stores/settings";

const store = useUsageStore();
const agents = useAgentsStore();
const settings = useSettingsStore();
const router = useRouter();
const { t } = useI18n();
const summaryFor = (source: AgentSource) => agents.items.find((item) => item.source === source);
const statusFor = (source: AgentSource): string =>
  t(
    `status.${store.collectorStatuses.find((item) => item.source === source)?.status ?? "NotDetected"}`,
  );
</script>

<template>
  <section class="page">
    <div class="page-heading">
      <div>
        <h2>{{ t("agents.title") }}</h2>
        <p>{{ t("agents.description") }}</p>
      </div>
    </div>
    <div class="agent-grid">
      <article v-for="source in ['codex', 'claude']" :key="source" class="panel agent-card">
        <div class="agent-card-top">
          <span class="large-agent-icon">{{ source === "codex" ? "C" : "A" }}</span
          ><span class="ready-badge">{{ statusFor(source as AgentSource) }}</span>
        </div>
        <h3>{{ source === "codex" ? "Codex" : "Claude Code" }}</h3>
        <p>{{ t(source === "codex" ? "agents.codexText" : "agents.claudeText") }}</p>
        <template v-if="summaryFor(source as AgentSource)">
          <div class="agent-summary-row"><strong>{{ formatTokenAmount(summaryFor(source as AgentSource)?.totalTokens ?? 0, { locale: settings.language, withUnitSuffix: true }) }}</strong><span>{{ t("overview.totalTokens") }}</span></div>
          <div class="agent-links"><button class="text-action" @click="router.push({ path: '/usage', query: { source } })">{{ t("usage.open") }} {{ t("nav.usage") }}</button><button class="text-action" @click="router.push({ path: '/sessions', query: { source } })">{{ t("usage.open") }} {{ t("nav.sessions") }}</button></div>
        </template>
        <dl>
          <div>
            <dt>{{ t("agents.records") }}</dt>
            <dd>
              {{ summaryFor(source as AgentSource)?.recordCount ?? 0 }}
            </dd>
          </div>
          <div><dt>{{ t("sessions.title") }}</dt><dd>{{ summaryFor(source as AgentSource)?.sessionCount ?? 0 }}</dd></div>
          <div>
            <dt>{{ t("agents.status") }}</dt>
            <dd>{{ t("agents.localOnly") }}</dd>
          </div>
        </dl>
      </article>
    </div>
  </section>
</template>
