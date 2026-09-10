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
function migrationStatus(snapshotStable: boolean, comparatorReady: boolean): string {
  if (!snapshotStable) return t("settings.v5SnapshotChanged");
  return comparatorReady ? t("settings.v5Ready") : t("settings.v5Blocked");
}
function gateMark(value: boolean): string {
  return value ? "✓" : "!";
}
function reasonLabel(reason: string): string {
  return t(`settings.v5Reason.${reason}`);
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
  try {
    await usage.resetLocalData();
  } catch (cause) {
    usage.recordError(cause instanceof Error ? cause.message : "Reset failed");
  }
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
      <details class="advanced-settings">
        <summary><strong>{{ t("settings.advancedDiagnostics") }}</strong><span>{{ t("settings.advancedDiagnosticsDescription") }}</span></summary>
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
          <span>{{ t("settings.rawProduction") }}: {{ formatTokens(usage.codexAccountingAuditReport.reconciliation.productionTokens) }}</span>
          <span>{{ t("settings.rawHybrid") }}: {{ formatTokens(usage.codexAccountingAuditReport.raw.methods.hybridCanonical.inputTokens + usage.codexAccountingAuditReport.raw.methods.hybridCanonical.cachedInputTokens + usage.codexAccountingAuditReport.raw.methods.hybridCanonical.cacheCreationInputTokens + usage.codexAccountingAuditReport.raw.methods.hybridCanonical.outputTokens + usage.codexAccountingAuditReport.raw.methods.hybridCanonical.reasoningOutputTokens) }}</span>
          <span>{{ t("settings.rawDatabase") }}: {{ formatTokens(usage.codexAccountingAuditReport.reconciliation.databaseTokens) }}</span>
          <span>{{ t("settings.rawDifference") }}: {{ formatTokens(usage.codexAccountingAuditReport.reconciliation.differenceTokens) }}</span>
          <span>{{ t("settings.rawSnapshot") }}: {{ usage.codexAccountingAuditReport.snapshotStable ? "✓" : "!" }}</span>
          <span>{{ t("settings.rawSources") }}: {{ usage.codexAccountingAuditReport.raw.usageSources.tokenCount.events }} / {{ usage.codexAccountingAuditReport.raw.usageSources.nestedInfoNonTokenCount.events }} / {{ usage.codexAccountingAuditReport.raw.usageSources.payloadUsage.events }} / {{ usage.codexAccountingAuditReport.raw.usageSources.flatPayloadUsage.events }}</span>
        </div>
      </div>
      <div v-if="usage.codexAccountingAuditReport?.v5MigrationValidation" class="audit-result">
        <h3>{{ t("settings.v5Validation") }}</h3>
        <div class="audit-summary">
          <span>{{ t("settings.v5V4Tokens") }}</span><strong>{{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v4.totalTokens) }} Token</strong>
          <span>{{ t("settings.v5Tokens") }}</span><strong>{{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.canonicalTokens) }} Token</strong>
          <span>{{ t("settings.v5Difference") }}</span><strong>{{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.difference.accountingTokens) }} Token</strong>
          <span>{{ t("settings.v5ChangedEvents") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.attribution.changedEvents.toLocaleString() }}</strong>
          <span>{{ t("settings.v5MixedEvents") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.attribution.mixedEvents.toLocaleString() }}</strong>
          <span>{{ t("settings.v5UnexplainedEvents") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.attribution.unexplainedEvents.toLocaleString() }}</strong>
          <span>{{ t("settings.v5MixedDelta") }}</span><strong>{{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.attribution.mixedDelta) }} Token</strong>
          <span>{{ t("settings.v5UnexplainedDelta") }}</span><strong>{{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.attribution.unexplainedDelta) }} Token</strong>
          <span>{{ t("settings.v5MigrationReady") }}</span><strong>{{ migrationStatus(usage.codexAccountingAuditReport.v5MigrationValidation.sourceSnapshotStable, usage.codexAccountingAuditReport.v5MigrationValidation.comparatorReady) }}</strong>
        </div>
        <h3 class="audit-subheading">{{ t("settings.v5Gates") }}</h3>
         <div class="audit-breakdown">
           <span>{{ t("settings.v5GateSource") }} {{ gateMark(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.gates.sourceIntegrity) }}</span>
          <span>{{ t("settings.v5GateUniverse") }} {{ gateMark(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.gates.universeComparable) }}</span>
          <span>{{ t("settings.v5GateInvariants") }} {{ gateMark(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.gates.v5ParserInvariants) }}</span>
          <span>{{ t("settings.v5GateActivation") }} {{ gateMark(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.gates.v5Activation) }}</span>
          <span>{{ t("settings.v5GateDuplicateSemantics") }} {{ gateMark(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.productionSemantics.tokenCountDuplicateSemantics) }}</span>
          <span>{{ t("settings.v5ScanRevision") }}</span><strong>1</strong>
          <span>{{ t("settings.v5GateMapping") }} {{ gateMark(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.gates.v4MappingComplete) }}</span>
          <span>{{ t("settings.v5GateAttribution") }} {{ gateMark(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.gates.attributionComplete) }}</span>
          <span>{{ t("settings.v5GateBalanced") }} {{ gateMark(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.gates.accountingBalanced) }}</span>
           <span>{{ t("settings.v5GateSnapshot") }} {{ gateMark(usage.codexAccountingAuditReport.v5MigrationValidation.sourceSnapshotStable) }}</span>
         </div>
         <h3 class="audit-subheading">{{ t("settings.v5ProductionSemantics") }}</h3>
         <div class="audit-summary">
           <span>{{ t("settings.v5ComparisonComplete") }}</span><strong>{{ gateMark(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.comparisonComplete) }}</strong>
           <span>{{ t("settings.v5ProductionValidated") }}</span><strong>{{ gateMark(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.productionSemantics.validated) }}</strong>
           <span>{{ t("settings.v5UnresolvedCandidates") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.productionSemantics.unresolvedSemanticCandidates.toLocaleString() }}</strong>
           <span>{{ t("settings.v5UnresolvedPrimaryTokens") }}</span><strong>{{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.productionSemantics.unresolvedPrimarySideTokens) }} Token</strong>
           <span>{{ t("settings.v5UnresolvedCandidateTokens") }}</span><strong>{{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.productionSemantics.unresolvedCandidateSideTokens) }} Token</strong>
           <span>{{ t("settings.v5UnresolvedAccountingDelta") }}</span><strong>{{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.productionSemantics.unresolvedAccountingDelta) }} Token</strong>
           <span>{{ t("settings.v5SuppressedEvents") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.suppressedDuplicateEvents.toLocaleString() }}</strong>
           <span>{{ t("settings.v5SuppressedTokens") }}</span><strong>{{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.suppressedDuplicateTokens) }} Token</strong>
         </div>
         <div class="audit-breakdown">
           <span>{{ t("settings.v5DuplicateCandidates") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.candidatePairs.toLocaleString() }}</span>
           <span>{{ t("settings.v5DuplicateConfirmed") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.confirmedPairs.toLocaleString() }}</span>
           <span>{{ t("settings.v5DuplicateStrong") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.strongPairs.toLocaleString() }}</span>
           <span>{{ t("settings.v5ResolvedStrong") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.resolvedStrongPairs.toLocaleString() }}</span>
           <span>{{ t("settings.v5SemanticSuppressed") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.semanticSnapshotDuplicateEvents.toLocaleString() }}</span>
           <span>{{ t("settings.v5StrongSuppressedTokens") }}: {{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.resolvedStrongSuppressedTokens) }} Token</span>
           <span>{{ t("settings.v5RepresentativeDelta") }}: {{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.representativeChoiceDelta) }} Token</span>
           <span>{{ t("settings.v5DuplicateProbable") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.probablePairs.toLocaleString() }}</span>
           <span>{{ t("settings.v5DuplicateConflicts") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.conflictPairs.toLocaleString() }}</span>
           <span>{{ t("settings.v5SemanticCandidates") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.semanticDuplicateCandidates.toLocaleString() }}</span>
           <span>{{ t("settings.v5TransitionPrimary") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.transition.primaryOnly.toLocaleString() }}</span>
           <span>{{ t("settings.v5TransitionCandidate") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.transition.candidateOnly.toLocaleString() }}</span>
           <span>{{ t("settings.v5TransitionBoth") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.transition.both.toLocaleString() }}</span>
           <span>{{ t("settings.v5TransitionNeither") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.transition.neither.toLocaleString() }}</span>
           <span>{{ t("settings.v5TransitionReset") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.transition.reset.toLocaleString() }}</span>
           <span>{{ t("settings.v5TransitionUnresolved") }}: {{ (usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.transition.incomparable + usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.transition.insufficient).toLocaleString() }}</span>
           <span>{{ t("settings.v5ProbablePrimaryTokens") }}: {{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.probablePrimaryTokens) }} Token</span>
           <span>{{ t("settings.v5ProbableCandidateTokens") }}: {{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.tokenCount.duplicateEvidence.probableCandidateTokens) }} Token</span>
         </div>
         <h3 class="audit-subheading">{{ t("settings.v5Reasons") }}</h3>
        <div class="audit-breakdown">
          <span v-for="item in usage.codexAccountingAuditReport.v5MigrationValidation.comparison.attribution.byReason.filter((item) => item.events > 0)" :key="item.reason">
            {{ reasonLabel(item.reason) }}: {{ formatTokens(item.delta) }} Token / {{ item.events.toLocaleString() }}
          </span>
        </div>
        <h3 class="audit-subheading">{{ t("settings.v5MappingEvidence") }}</h3>
        <div class="audit-breakdown">
          <span>{{ t("settings.v5MappingUnique") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.universe.v4RecordMapping.uniqueRecords.toLocaleString() }}</span>
          <span>{{ t("settings.v5MappingMetadata") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.universe.v4RecordMapping.resolvedByMetadataRecords.toLocaleString() }}</span>
          <span>{{ t("settings.v5MappingUsageResolved") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.universe.v4RecordMapping.resolvedByUsageRecords.toLocaleString() }}</span>
          <span>{{ t("settings.v5MappingSemanticSuppression") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.universe.v4RecordMapping.resolvedBySemanticSuppressionRecords.toLocaleString() }}</span>
          <span>{{ t("settings.v5MappingEquivalent") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.universe.v4RecordMapping.equivalentCollisionRecords.toLocaleString() }}</span>
          <span>{{ t("settings.v5MappingEquivalentUsage") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.universe.v4RecordMapping.equivalentUsageCollisionRecords.toLocaleString() }}</span>
          <span>{{ t("settings.v5MappingAmbiguous") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.universe.v4RecordMapping.ambiguousRecords.toLocaleString() }}</span>
          <span>{{ t("settings.v5MappingUsageUnique") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.universe.v4RecordMapping.ambiguousUsageUniqueMatchRecords.toLocaleString() }}</span>
          <span>{{ t("settings.v5MappingUsageNone") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.universe.v4RecordMapping.ambiguousUsageNoMatchRecords.toLocaleString() }}</span>
          <span>{{ t("settings.v5MappingUsageMultiple") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.universe.v4RecordMapping.ambiguousUsageMultipleMatchRecords.toLocaleString() }}</span>
        </div>
        <h3 class="audit-subheading">{{ t("settings.v5ForkEvidence") }}</h3>
        <div class="audit-breakdown">
          <span>{{ t("settings.v5ForkPairs") }}: {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.forkEvidence.forkPairCount.toLocaleString() }}</span>
          <span>{{ t("settings.v5ForkInside") }}: {{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.forkEvidence.unexplainedDeltaInsideForkFamilies) }} Token / {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.forkEvidence.unexplainedEventsInsideForkFamilies.toLocaleString() }}</span>
          <span>{{ t("settings.v5ForkOutside") }}: {{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.forkEvidence.unexplainedDeltaOutsideForkFamilies) }} Token / {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.forkEvidence.unexplainedEventsOutsideForkFamilies.toLocaleString() }}</span>
          <span v-for="pair in usage.codexAccountingAuditReport.v5MigrationValidation.comparison.forkEvidence.pairs.slice(0, 5)" :key="`${pair.parentSessionId}-${pair.childSessionId}`">
            {{ pair.parentSessionId.slice(0, 8) }} → {{ pair.childSessionId.slice(0, 8) }}: {{ t("settings.v5ForkFamilyDelta") }} {{ formatTokens(pair.familyDelta) }} Token / {{ t("settings.v5ForkResidual") }} {{ formatTokens(pair.residualIfDuplicatesSuppressed) }} Token
            <template v-if="pair.counterResetGap !== undefined"> / {{ t("settings.v5ForkCounterResetGap") }} {{ formatTokens(pair.counterResetGap) }} Token</template>
          </span>
        </div>
        <h3 class="audit-subheading">{{ t("settings.v5Diagnostics") }}</h3>
        <div class="audit-summary">
          <span>{{ t("settings.v5ParseErrors") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.source.filesWithParseErrors.toLocaleString() }} / {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.source.parseErrorCount.toLocaleString() }}</strong>
          <span>{{ t("settings.v5SessionConflicts") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.decode.sessionIdentityConflicts.toLocaleString() }} / {{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.decode.parentIdentityConflicts.toLocaleString() }}</strong>
          <span>{{ t("settings.v5LogicalConflicts") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.reconcile.conflictingLogicalSessions.toLocaleString() }}</strong>
          <span>{{ t("settings.v5RawDuplicateGroups") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.rawContentDuplicates.groups.toLocaleString() }}</strong>
          <span>{{ t("settings.v5RawDuplicateOccurrences") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.rawContentDuplicates.duplicateOccurrences.toLocaleString() }}</strong>
          <span>{{ t("settings.v5RawDuplicateTokens") }}</span><strong>{{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.rawContentDuplicates.candidateExtraTokens) }} Token</strong>
          <span>{{ t("settings.v5DuplicateV5Only") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.rawContentDuplicates.v5OnlyOccurrences.toLocaleString() }} / {{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.rawContentDuplicates.v5OnlyTokens) }} Token</strong>
          <span>{{ t("settings.v5DuplicateUnexplained") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.rawContentDuplicates.unexplainedOccurrences.toLocaleString() }} / {{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.rawContentDuplicates.unexplainedTokens) }} Token</strong>
          <span>{{ t("settings.v5UnknownModel") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.projection.unknownModelRecords.toLocaleString() }} / {{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.projection.unknownModelTokens) }} Token</strong>
          <span>{{ t("settings.v5OnlyMissingModel") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.attribution.v5OnlyMissingModelEvents.toLocaleString() }} / {{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.attribution.v5OnlyMissingModelTokens) }} Token</strong>
          <span>{{ t("settings.v5OnlyAggregateLast") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.attribution.v5OnlyAggregateLastEvents.toLocaleString() }} / {{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.attribution.v5OnlyAggregateLastTokens) }} Token</strong>
          <span>{{ t("settings.v5OnlyMissingModelAggregateLast") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.attribution.v5OnlyMissingModelAggregateLastEvents.toLocaleString() }} / {{ formatTokens(usage.codexAccountingAuditReport.v5MigrationValidation.comparison.attribution.v5OnlyMissingModelAggregateLastTokens) }} Token</strong>
          <span>{{ t("settings.v5ReplayMismatch") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.forkReplay.replayPrefixMismatchSessions.toLocaleString() }}</strong>
          <span>{{ t("settings.v5MissingParent") }}</span><strong>{{ usage.codexAccountingAuditReport.v5MigrationValidation.comparison.v5.diagnostics.forkBaseline.missingParentSessions.toLocaleString() }}</strong>
        </div>
      </div>
      </details>
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
