<script setup lang="ts">
import type { AgentSource } from "@lw-aiusage/core";
import { useUsageStore } from "../stores/usage";
import { useI18n } from "../i18n";

const store = useUsageStore();
const { t } = useI18n();
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
      <article class="panel agent-card">
        <div class="agent-card-top">
          <span class="large-agent-icon">C</span
          ><span class="ready-badge">{{ statusFor("codex") }}</span>
        </div>
        <h3>Codex</h3>
        <p>{{ t("agents.codexText") }}</p>
        <dl>
          <div>
            <dt>{{ t("agents.records") }}</dt>
            <dd>
              {{ store.records.filter((r) => r.source === "codex").length }}
            </dd>
          </div>
          <div>
            <dt>{{ t("agents.status") }}</dt>
            <dd>{{ t("agents.localOnly") }}</dd>
          </div>
        </dl>
      </article>
      <article class="panel agent-card">
        <div class="agent-card-top">
          <span class="large-agent-icon">A</span
          ><span class="ready-badge">{{ statusFor("claude") }}</span>
        </div>
        <h3>Claude Code</h3>
        <p>{{ t("agents.claudeText") }}</p>
        <dl>
          <div>
            <dt>{{ t("agents.records") }}</dt>
            <dd>
              {{ store.records.filter((r) => r.source === "claude").length }}
            </dd>
          </div>
          <div>
            <dt>{{ t("agents.status") }}</dt>
            <dd>{{ t("agents.localOnly") }}</dd>
          </div>
        </dl>
      </article>
    </div>
  </section>
</template>
