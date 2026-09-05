<script setup lang="ts">
import { ref } from "vue";
import { useSettingsStore, type ThemeMode } from "../stores/settings";
import { useUsageStore } from "../stores/usage";
import { useI18n } from "../i18n";
import { formatTokenAmount } from "../format";

const settings = useSettingsStore();
const usage = useUsageStore();
const { t, locale } = useI18n();
const busy = ref(false);
const auditBusy = ref(false);
const formatTokens = (value: number): string => formatTokenAmount(value, { locale: locale.value });
function changeLanguage(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  settings.setLanguage(value === "zh" ? "zh" : "en");
}
function changeTheme(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value === "system" || value === "light" || value === "dark")
    settings.setTheme(value as ThemeMode);
}
async function rebuild(): Promise<void> {
  if (!window.confirm(t("confirm.rebuild"))) return;
  busy.value = true;
  try {
    await usage.rebuild();
  } finally {
    busy.value = false;
  }
}
async function resetData(): Promise<void> {
  if (!window.confirm(t("confirm.reset"))) return;
  await usage.resetLocalData();
}
async function generateAudit(): Promise<void> {
  auditBusy.value = true;
  try {
    await usage.exportUsageAudit();
  } finally {
    auditBusy.value = false;
  }
}
async function runRawAudit(): Promise<void> {
  try {
    await usage.runCodexRawAudit();
  } catch (cause) {
    await usage.recordError(cause instanceof Error ? cause.message : "Raw audit failed");
  }
}
</script>

<template>
  <section class="page">
    <div class="page-heading">
      <div>
        <h2>{{ t("settings.title") }}</h2>
        <p>{{ t("settings.description") }}</p>
      </div>
    </div>
    <article class="panel settings-panel">
      <div class="setting-row">
        <div>
          <h3>{{ t("settings.language") }}</h3>
          <p>{{ t("settings.languageDescription") }}</p>
        </div>
        <select
          class="theme-select"
          :value="settings.language"
          @change="changeLanguage"
        >
          <option value="zh">{{ t("settings.chinese") }}</option>
          <option value="en">{{ t("settings.english") }}</option>
        </select>
      </div>
      <div class="setting-row">
        <div>
          <h3>{{ t("settings.audit") }}</h3>
          <p>{{ t("settings.auditDescription") }}</p>
        </div>
        <button class="setting-action" :disabled="auditBusy" @click="generateAudit">
          {{ auditBusy ? t("settings.rebuilding") : t("settings.auditAction") }}
        </button>
      </div>
      <div v-if="usage.rebuildAudit" class="audit-result">
        <h3>{{ t("settings.rebuildResult") }}</h3>
        <div class="audit-summary">
          <span>{{ t("settings.auditRecords") }}</span><strong>{{ usage.rebuildAudit.before.recordCount.toLocaleString() }} → {{ usage.rebuildAudit.after.recordCount.toLocaleString() }}</strong>
          <span>{{ t("settings.auditSessions") }}</span><strong>{{ usage.rebuildAudit.before.sessionCount.toLocaleString() }} → {{ usage.rebuildAudit.after.sessionCount.toLocaleString() }}</strong>
          <span>{{ t("settings.auditCurrent") }}</span><strong>{{ formatTokens(usage.rebuildAudit.before.totals.currentTotal) }} → {{ formatTokens(usage.rebuildAudit.after.totals.currentTotal) }}</strong>
          <span>{{ t("settings.auditWithoutCached") }}</span><strong>{{ formatTokens(usage.rebuildAudit.after.totals.withoutCached) }}</strong>
          <span>{{ t("settings.auditWithoutCreation") }}</span><strong>{{ formatTokens(usage.rebuildAudit.after.totals.withoutCacheCreation) }}</strong>
          <span>{{ t("settings.auditWithoutReasoning") }}</span><strong>{{ formatTokens(usage.rebuildAudit.after.totals.withoutReasoning) }}</strong>
          <span>{{ t("settings.auditWithoutAllCache") }}</span><strong>{{ formatTokens(usage.rebuildAudit.after.totals.withoutAllCache) }}</strong>
          <span>{{ t("settings.auditPlainIo") }}</span><strong>{{ formatTokens(usage.rebuildAudit.after.totals.plainInputOutput) }}</strong>
          <span>{{ t("settings.auditRawIo") }}</span><strong>{{ formatTokens(usage.rebuildAudit.after.totals.rawIoEquivalent) }}</strong>
          <span>{{ t("settings.change") }}</span><strong>{{ formatTokens(usage.rebuildAudit.difference.tokens) }} ({{ usage.rebuildAudit.difference.percent.toFixed(1) }}%)</strong>
        </div>
        <div class="audit-breakdown">
          <span>{{ t("settings.auditInput") }}: {{ formatTokens(usage.rebuildAudit.after.usage.inputTokens) }}</span>
          <span>{{ t("settings.auditCached") }}: {{ formatTokens(usage.rebuildAudit.after.usage.cachedInputTokens) }}</span>
          <span>{{ t("settings.auditCreation") }}: {{ formatTokens(usage.rebuildAudit.after.usage.cacheCreationInputTokens) }}</span>
          <span>{{ t("settings.auditOutput") }}: {{ formatTokens(usage.rebuildAudit.after.usage.outputTokens) }}</span>
          <span>{{ t("settings.auditReasoning") }}: {{ formatTokens(usage.rebuildAudit.after.usage.reasoningOutputTokens) }}</span>
        </div>
      </div>
      <div v-if="usage.auditReport" class="audit-result">
        <h3>{{ t("settings.auditSources") }}</h3>
        <div class="audit-breakdown"><span v-for="item in usage.auditReport.bySource" :key="item.source">{{ item.source }}: {{ formatTokens(item.totals.currentTotal) }} / {{ item.recordCount }} {{ t("settings.auditRecords") }}</span></div>
        <h3 class="audit-subheading">{{ t("settings.auditModels") }}</h3>
        <div class="audit-breakdown"><span v-for="item in usage.auditReport.byModel" :key="item.model">{{ item.model }}: {{ formatTokens(item.totals.currentTotal) }}</span></div>
        <h3 class="audit-subheading">{{ t("settings.auditPeakDays") }}</h3>
        <div class="audit-breakdown"><span v-for="item in usage.auditReport.peakDays.slice(0, 5)" :key="item.day">{{ item.day }}: {{ formatTokens(item.totals.currentTotal) }}</span></div>
      </div>
      <div class="setting-row">
        <div>
          <h3>{{ t("settings.rawAudit") }}</h3>
          <p>{{ t("settings.rawAuditDescription") }}</p>
          <small v-if="usage.rawAuditBusy && usage.rawAuditProgress">{{ t("settings.rawAuditProgress") }} {{ usage.rawAuditProgress.current }} / {{ usage.rawAuditProgress.total }}</small>
        </div>
        <button class="setting-action" :disabled="usage.rawAuditBusy" @click="runRawAudit">
          {{ usage.rawAuditBusy ? t("settings.rawAuditing") : t("settings.rawAuditAction") }}
        </button>
      </div>
      <div v-if="usage.rawAuditReport" class="audit-result">
        <div class="audit-summary">
          <span>{{ t("settings.rawFiles") }}</span><strong>{{ usage.rawAuditReport.files }} / {{ usage.rawAuditReport.canonicalFiles }}</strong>
          <span>{{ t("settings.rawDuplicateFiles") }}</span><strong>{{ usage.rawAuditReport.duplicateFiles }}</strong>
          <span>{{ t("settings.rawSessions") }}</span><strong>{{ usage.rawAuditReport.sessions }}</strong>
          <span>{{ t("settings.rawForks") }}</span><strong>{{ usage.rawAuditReport.fork.sessions }}</strong>
          <span>{{ t("settings.rawBaselineMissing") }}</span><strong>{{ usage.rawAuditReport.fork.baselineMissing }}</strong>
          <span>{{ t("settings.rawLastSum") }}</span><strong>{{ formatTokens(usage.rawAuditReport.methods.lastUsageSum.inputTokens + usage.rawAuditReport.methods.lastUsageSum.cachedInputTokens + usage.rawAuditReport.methods.lastUsageSum.outputTokens + usage.rawAuditReport.methods.lastUsageSum.reasoningOutputTokens) }}</strong>
          <span>{{ t("settings.rawTotalDelta") }}</span><strong>{{ formatTokens(usage.rawAuditReport.methods.totalDeltaSum.inputTokens + usage.rawAuditReport.methods.totalDeltaSum.cachedInputTokens + usage.rawAuditReport.methods.totalDeltaSum.outputTokens + usage.rawAuditReport.methods.totalDeltaSum.reasoningOutputTokens) }}</strong>
          <span>{{ t("settings.rawCurrentEquivalent") }}</span><strong>{{ formatTokens(usage.rawAuditReport.methods.currentEquivalent.inputTokens + usage.rawAuditReport.methods.currentEquivalent.cachedInputTokens + usage.rawAuditReport.methods.currentEquivalent.outputTokens + usage.rawAuditReport.methods.currentEquivalent.reasoningOutputTokens) }}</strong>
          <span>{{ t("settings.rawMismatchTokens") }}</span><strong>{{ formatTokens(usage.rawAuditReport.discrepancy.positiveMismatchTokens) }}</strong>
          <span>{{ t("settings.rawRepeatedSnapshots") }}</span><strong>{{ usage.rawAuditReport.events.repeatedTotalWithNonZeroLast }}</strong>
          <span>{{ t("settings.rawCounterDecreases") }}</span><strong>{{ usage.rawAuditReport.events.totalCounterDecrease }}</strong>
        </div>
        <div v-if="usage.codexAccountingAuditReport" class="audit-breakdown">
          <span>{{ t("settings.rawAccounting") }}: {{ usage.codexAccountingAuditReport.accounting }}</span>
          <span>{{ t("settings.rawParserEquivalent") }}: {{ formatTokens(usage.codexAccountingAuditReport.reconciliation.parserEquivalentV4Tokens) }}</span>
          <span>{{ t("settings.rawHybrid") }}: {{ formatTokens(usage.codexAccountingAuditReport.raw.methods.hybridCanonical.inputTokens + usage.codexAccountingAuditReport.raw.methods.hybridCanonical.cachedInputTokens + usage.codexAccountingAuditReport.raw.methods.hybridCanonical.cacheCreationInputTokens + usage.codexAccountingAuditReport.raw.methods.hybridCanonical.outputTokens + usage.codexAccountingAuditReport.raw.methods.hybridCanonical.reasoningOutputTokens) }}</span>
          <span>{{ t("settings.rawDatabase") }}: {{ formatTokens(usage.codexAccountingAuditReport.reconciliation.databaseTokens) }}</span>
          <span>{{ t("settings.rawDifference") }}: {{ formatTokens(usage.codexAccountingAuditReport.reconciliation.differenceTokens) }}</span>
          <span>{{ t("settings.rawSnapshot") }}: {{ usage.codexAccountingAuditReport.snapshotStable ? "✓" : "!" }}</span>
          <span>{{ t("settings.rawSources") }}: {{ usage.codexAccountingAuditReport.raw.usageSources.tokenCount.events }} / {{ usage.codexAccountingAuditReport.raw.usageSources.nestedInfoNonTokenCount.events }} / {{ usage.codexAccountingAuditReport.raw.usageSources.payloadUsage.events }} / {{ usage.codexAccountingAuditReport.raw.usageSources.flatPayloadUsage.events }}</span>
        </div>
      </div>
      <div class="setting-row">
        <div>
          <h3>{{ t("settings.theme") }}</h3>
          <p>{{ t("settings.themeDescription") }}</p>
        </div>
        <select
          class="theme-select"
          :value="settings.theme"
          @change="changeTheme"
        >
          <option value="system">{{ t("settings.system") }}</option>
          <option value="light">{{ t("settings.light") }}</option>
          <option value="dark">{{ t("settings.dark") }}</option>
        </select>
      </div>
      <div class="setting-row">
        <div>
          <h3>{{ t("settings.showCost") }}</h3>
          <p>{{ t("settings.showCostDescription") }}</p>
        </div>
        <span class="toggle on">{{ t("settings.on") }}</span>
      </div>
      <div class="setting-row">
        <div>
          <h3>{{ t("settings.collectProject") }}</h3>
          <p>{{ t("settings.collectProjectDescription") }}</p>
        </div>
        <span class="toggle on">{{ t("settings.on") }}</span>
      </div>
      <div class="setting-row">
        <div>
          <h3>{{ t("settings.rebuild") }}</h3>
          <p>{{ t("settings.rebuildDescription") }}</p>
        </div>
        <button class="setting-action" :disabled="busy" @click="rebuild">
          {{ busy ? t("settings.rebuilding") : t("settings.rebuildAction") }}
        </button>
      </div>
      <div class="setting-row">
        <div>
          <h3>{{ t("settings.diagnostics") }}</h3>
          <p>{{ t("settings.diagnosticsDescription") }}</p>
        </div>
        <button class="setting-action" @click="usage.exportDiagnostics">
          {{ t("settings.export") }}
        </button>
      </div>
      <div class="setting-row danger-row">
        <div>
          <h3>{{ t("settings.reset") }}</h3>
          <p>{{ t("settings.resetDescription") }}</p>
        </div>
        <button class="danger-action" @click="resetData">
          {{ t("settings.resetAction") }}
        </button>
      </div>
      <div class="setting-row">
        <div>
          <h3>{{ t("settings.cloudSync") }}</h3>
          <p>{{ t("settings.cloudSyncDescription") }}</p>
        </div>
        <span class="privacy-chip">{{ t("settings.localOnly") }}</span>
      </div>
    </article>
  </section>
</template>
