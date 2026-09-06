import { totalTokens, zeroUsage, type TokenUsage } from "@lw-aiusage/core";
import { objectValue, stableEventId, stringValue, stableHash } from "../shared/identity";
import type { CodexExtractedEvent, CodexExtractedFile, CodexUsageSource } from "./rawAuditTypes";
import { replayCodexV4 } from "./parserV4Mirror";
import { decodeCodexFileV5, stableCodexEventJsonV5, type CodexParsedFileInputV5 } from "./eventDecoderV5";
import { parseCodexFilesV5, type CodexV5ParseResult, type CodexV5SessionParseResult } from "./parserV5";
import { resolveForkBaselinesV5, type CanonicalUsageContributionV5, type ForkBaselineResolutionV5 } from "./forkReplayV5";
import { reconcileCodexLogicalSessionsV5 } from "./logicalSessionV5";
import type { CodexAccountingEvent } from "./accountingV5";
import type { ParserV4MirrorRecord } from "./rawAuditTypes";

export interface CodexComparisonEventIdentity {
  sessionId: string;
  rawIdentity: string;
}

export type CodexV4V5DeltaReason =
  | "same"
  | "fork-baseline"
  | "fork-replay"
  | "token-reset"
  | "token-aggregate"
  | "payload-suppression"
  | "payload-fallback"
  | "taxonomy-non-token-usage"
  | "v4-only"
  | "v5-only"
  | "usage-changed"
  | "unexplained";

export interface SignedTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface CodexEventComparisonV5 {
  key: string;
  sessionId: string;
  rawIdentity: string;
  eventIndex: number;
  timestamp?: number;
  semanticType?: string;
  v4?: {
    recordId: string;
    sourceKind: CodexUsageSource;
    usage: TokenUsage;
    total: number;
  };
  v5: {
    beforeFork: CanonicalUsageContributionV5[];
    afterFork: CanonicalUsageContributionV5[];
    tokenRef?: { method: string; aggregateTotal: number };
    payloadFallbacks: CodexV5SessionParseResult["payloadFallbacks"];
    totalBeforeFork: number;
    totalAfterFork: number;
  };
  delta: number;
  componentDelta: SignedTokenUsage;
  reason: CodexV4V5DeltaReason;
  explained: boolean;
}

export interface CodexDeltaReasonSummary {
  reason: CodexV4V5DeltaReason;
  events: number;
  v4Tokens: number;
  v5Tokens: number;
  delta: number;
  explainedDelta: number;
}

export interface CodexSessionComparisonV5 {
  sessionId: string;
  v4Records: number;
  v5Contributions: number;
  v4Tokens: number;
  v5Tokens: number;
  delta: number;
  reasons: CodexDeltaReasonSummary[];
  changedEvents: number;
  unexplainedEvents: number;
}

export interface CodexV4MappingDiagnostics {
  records: number;
  mappedRecords: number;
  unmappedRecords: number;
  ambiguousRecords: number;
  candidateIdCollisions: number;
}

export interface CodexComparisonUniverse {
  discoveredFiles: number;
  v4CanonicalFiles: number;
  v5LogicalSessions: number;
  v5ExactDuplicateFiles: number;
  v5PrefixShadowedFiles: number;
  v5ConflictingLogicalSessions: number;
  v5OrphanFiles: number;
  v4RecordMapping: CodexV4MappingDiagnostics;
}

export interface CodexV4V5ComparisonGates {
  sourceIntegrity: boolean;
  universeComparable: boolean;
  v5ParserInvariants: boolean;
  v5Activation: boolean;
  v4MappingComplete: boolean;
  attributionComplete: boolean;
  accountingBalanced: boolean;
}

export interface CodexV4V5ComparisonReport {
  comparatorVersion: 1;
  snapshot: { files: number };
  universe: CodexComparisonUniverse;
  v4: {
    recordCount: number;
    sessionCount: number;
    usage: TokenUsage;
    totalTokens: number;
  };
  v5: {
    canonicalContributions: number;
    emittedRecords: number;
    canonicalUsage: TokenUsage;
    canonicalTokens: number;
    emittedTokens: number;
    safeToActivate: boolean;
  };
  difference: {
    components: SignedTokenUsage;
    accountingTokens: number;
    projectionTokens: number;
  };
  attribution: {
    byReason: CodexDeltaReasonSummary[];
    explainedDelta: number;
    unexplainedDelta: number;
    changedEvents: number;
    unexplainedEvents: number;
  };
  sessions: CodexSessionComparisonV5[];
  largestAbsoluteSessionDelta: CodexSessionComparisonV5[];
  details: {
    unexplained: CodexEventComparisonV5[];
    largestChanges: CodexEventComparisonV5[];
    examplesByReason: Record<CodexV4V5DeltaReason, CodexEventComparisonV5[]>;
  };
  gates: CodexV4V5ComparisonGates;
  readyForCollectorSwitch: boolean;
  comparisonEntries: CodexEventComparisonV5[];
}

export interface CodexV4V5ComparatorOptions {
  detailLimit?: number;
}

const reasons: CodexV4V5DeltaReason[] = [
  "same", "fork-baseline", "fork-replay", "token-reset", "token-aggregate",
  "payload-suppression", "payload-fallback", "taxonomy-non-token-usage", "v4-only",
  "v5-only", "usage-changed", "unexplained",
];

const comparisonEventKey = (sessionId: string, rawIdentity: string): string => `${sessionId}\n${rawIdentity}`;

const addUsage = (target: TokenUsage, value: TokenUsage): void => {
  target.inputTokens += value.inputTokens;
  target.cachedInputTokens += value.cachedInputTokens;
  target.cacheCreationInputTokens += value.cacheCreationInputTokens;
  target.outputTokens += value.outputTokens;
  target.reasoningOutputTokens += value.reasoningOutputTokens;
};

const usageOf = (contributions: readonly CanonicalUsageContributionV5[]): TokenUsage => {
  const usage = zeroUsage();
  for (const contribution of contributions) addUsage(usage, contribution.usage);
  return usage;
};

const subtractUsageSigned = (left: TokenUsage, right: TokenUsage): SignedTokenUsage => ({
  inputTokens: left.inputTokens - right.inputTokens,
  cachedInputTokens: left.cachedInputTokens - right.cachedInputTokens,
  cacheCreationInputTokens: left.cacheCreationInputTokens - right.cacheCreationInputTokens,
  outputTokens: left.outputTokens - right.outputTokens,
  reasoningOutputTokens: left.reasoningOutputTokens - right.reasoningOutputTokens,
});

const usageEqual = (left: TokenUsage, right: TokenUsage): boolean =>
  left.inputTokens === right.inputTokens &&
  left.cachedInputTokens === right.cachedInputTokens &&
  left.cacheCreationInputTokens === right.cacheCreationInputTokens &&
  left.outputTokens === right.outputTokens &&
  left.reasoningOutputTokens === right.reasoningOutputTokens;

const signedNonZero = (usage: SignedTokenUsage): boolean => Object.values(usage).some((value) => value !== 0);

const eventSessionId = (file: CodexExtractedFile, event: CodexExtractedEvent): string =>
  file.finalSessionId ?? file.peekLogicalId ?? event.resolvedSessionId ?? "unknown";

const protocolNodes = (event: CodexExtractedEvent): { payload: Record<string, unknown>; msg?: Record<string, unknown>; info?: Record<string, unknown> } => {
  const payload = objectValue(event.raw.payload) ?? event.raw;
  const msg = objectValue(payload.msg);
  return { payload, msg, info: objectValue(payload.info) ?? objectValue(msg?.info) ?? objectValue(event.raw.info) };
};

// Kept intentionally identical to the frozen mirror's stringAt behavior.
const mirrorStringAt = (value: unknown, ...keys: string[]): string | undefined => {
  let current: unknown = value;
  for (const key of keys) current = objectValue(current)?.[key];
  return stringValue(current);
};

const v4CandidateRecordId = (file: CodexExtractedFile, event: CodexExtractedEvent): string => {
  const { payload } = protocolNodes(event);
  const msg = objectValue(payload.msg);
  const info = objectValue(payload.info) ?? objectValue(msg?.info) ?? objectValue(event.raw.info);
  const lastNode = info?.last_token_usage ?? info?.lastTokenUsage;
  const totalNode = info?.total_token_usage ?? info?.totalTokenUsage;
  const rawUsageNode = lastNode ?? totalNode ?? objectValue(payload.usage) ?? payload;
  return stableEventId("codex", file.peekLogicalId ?? event.resolvedSessionId ?? file.entry.path, event.raw, {
    timestamp: event.raw.timestamp,
    turnId: mirrorStringAt(payload, "turn_id", "turnId"),
    responseId: mirrorStringAt(payload, "response_id", "responseId"),
    total: totalNode ?? rawUsageNode,
  });
};

export function codexExtractedFilesToV5Inputs(
  files: readonly CodexExtractedFile[],
): CodexParsedFileInputV5[] {
  return files.map((file) => ({
    sourcePath: file.entry.path,
    logicalIdHint: file.peekLogicalId,
    values: file.events.map((event) => event.raw),
    parseErrors: [...file.parseErrors],
    hasPendingText: false,
  }));
}

interface EntryAccumulator {
  key: string;
  sessionId: string;
  rawIdentity: string;
  eventIndex: number;
  timestamp?: number;
  semanticType?: string;
  source?: CodexUsageSource;
  v4Records: ParserV4MirrorRecord[];
  beforeFork: CanonicalUsageContributionV5[];
  afterFork: CanonicalUsageContributionV5[];
  tokenRef?: { method: string; aggregateTotal: number };
  payloadFallbacks: CodexV5SessionParseResult["payloadFallbacks"];
}

const rawIdentityOf = (event: CodexExtractedEvent | CodexAccountingEvent): string => {
  if ("rawIdentity" in event) return event.rawIdentity;
  return `e${event.eventIndex}:h${stableHash(stableCodexEventJsonV5(event.raw))}`;
};

const eventTimestampOf = (event: CodexExtractedEvent | CodexAccountingEvent): number | undefined =>
  "rawIdentity" in event ? event.timestamp : event.explicitTimestamp;

const ensureEntry = (
  entries: Map<string, EntryAccumulator>,
  sessionId: string,
  event: CodexExtractedEvent | CodexAccountingEvent,
): EntryAccumulator => {
  const rawIdentity = rawIdentityOf(event);
  const key = comparisonEventKey(sessionId, rawIdentity);
  const existing = entries.get(key);
  if (existing) return existing;
  const created: EntryAccumulator = {
    key,
    sessionId,
    rawIdentity,
    eventIndex: event.eventIndex,
    timestamp: eventTimestampOf(event),
    semanticType: event.semanticType,
    v4Records: [],
    beforeFork: [],
    afterFork: [],
    payloadFallbacks: [],
  };
  entries.set(key, created);
  return created;
};

const recordMetadataOf = (files: readonly CodexExtractedFile[]): Map<string, CodexExtractedEvent> => {
  const result = new Map<string, CodexExtractedEvent>();
  for (const file of files) for (const event of file.events) {
    const sessionId = eventSessionId(file, event);
    result.set(comparisonEventKey(sessionId, rawIdentityOf(event)), event);
  }
  return result;
};

const addV5Contribution = (
  entries: Map<string, EntryAccumulator>,
  sessionId: string,
  contribution: CanonicalUsageContributionV5,
  position: "before" | "after",
): void => {
  const entry = ensureEntry(entries, sessionId, contribution.event);
  entry[position === "before" ? "beforeFork" : "afterFork"].push(contribution);
};

const buildV4Mapping = (
  files: readonly CodexExtractedFile[],
  v4: ReturnType<typeof replayCodexV4>,
  entries: Map<string, EntryAccumulator>,
): CodexV4MappingDiagnostics => {
  const candidates = new Map<string, Set<string>>();
  const eventByKey = recordMetadataOf(files);
  for (const file of files) for (const event of file.events) {
    const candidateId = v4CandidateRecordId(file, event);
    const identityKey = comparisonEventKey(eventSessionId(file, event), rawIdentityOf(event));
    const set = candidates.get(candidateId) ?? new Set<string>();
    set.add(identityKey);
    candidates.set(candidateId, set);
  }
  let candidateIdCollisions = 0;
  for (const identities of candidates.values()) if (identities.size > 1) candidateIdCollisions += 1;
  let mappedRecords = 0;
  let unmappedRecords = 0;
  let ambiguousRecords = 0;
  for (const [recordId, record] of v4.records) {
    const identities = candidates.get(recordId);
    if (!identities || identities.size === 0) {
      unmappedRecords += 1;
      const key = `v4-only\n${recordId}`;
      entries.set(key, {
        key,
        sessionId: record.sessionId ?? "unknown",
        rawIdentity: "",
        eventIndex: -1,
        timestamp: record.timestamp,
        v4Records: [record],
        beforeFork: [],
        afterFork: [],
        payloadFallbacks: [],
      });
      continue;
    }
    if (identities.size > 1) {
      ambiguousRecords += 1;
      const key = `v4-ambiguous\n${recordId}`;
      entries.set(key, {
        key,
        sessionId: record.sessionId ?? "unknown",
        rawIdentity: "",
        eventIndex: -1,
        timestamp: record.timestamp,
        v4Records: [record],
        beforeFork: [],
        afterFork: [],
        payloadFallbacks: [],
      });
      continue;
    }
    const identityKey = [...identities][0]!;
    const event = eventByKey.get(identityKey);
    const entry = event ? ensureEntry(entries, identityKey.split("\n")[0]!, event) : entries.get(identityKey);
    if (entry) entry.v4Records.push(record);
    mappedRecords += 1;
  }
  return { records: v4.records.size, mappedRecords, unmappedRecords, ambiguousRecords, candidateIdCollisions };
};

const baselineResolutionMap = (v5: CodexV5ParseResult, files: readonly CodexExtractedFile[]): Map<string, ForkBaselineResolutionV5> => {
  const decoded = files.map((file) => decodeCodexFileV5({
    sourcePath: file.entry.path,
    logicalIdHint: file.peekLogicalId,
    values: file.events.map((event) => event.raw),
    parseErrors: file.parseErrors,
  }));
  const reconciled = reconcileCodexLogicalSessionsV5(decoded);
  const plan = resolveForkBaselinesV5(reconciled.sessions.map((session) => ({
    sessionId: session.sessionId,
    parentSessionId: session.parentSessionId,
    forkTimestamp: session.forkTimestamp,
    events: session.events,
  })));
  void v5;
  return plan.resolutions;
};

const classify = (
  entry: EntryAccumulator,
  v4Usage: TokenUsage,
  v5Usage: TokenUsage,
  baselines: Map<string, ForkBaselineResolutionV5>,
): { reason: CodexV4V5DeltaReason; explained: boolean } => {
  const delta = totalTokens(v5Usage) - totalTokens(v4Usage);
  const changed = delta !== 0 || !usageEqual(v4Usage, v5Usage);
  if (!changed) return { reason: "same", explained: true };
  if (entry.beforeFork.length > entry.afterFork.length && entry.afterFork.length === 0)
    return { reason: "fork-replay", explained: true };
  const baseline = baselines.get(entry.sessionId);
  if (baseline?.status === "resolved" && baseline.firstChildTotalEvent?.rawIdentity === entry.rawIdentity)
    return { reason: "fork-baseline", explained: true };
  if (entry.source === "nested-info-non-token-count" && entry.afterFork.length === 0)
    return { reason: "taxonomy-non-token-usage", explained: true };
  if (entry.payloadFallbacks.length > 0 && entry.v4Records.length === 0)
    return { reason: "payload-fallback", explained: true };
  if ((entry.v4Records[0]?.sourceKind === "payload-usage" || entry.v4Records[0]?.sourceKind === "flat-payload") && entry.afterFork.length === 0)
    return { reason: "payload-suppression", explained: true };
  if (entry.tokenRef?.method === "total-reset") return { reason: "token-reset", explained: true };
  if (entry.tokenRef?.method === "total-aggregate" || entry.tokenRef?.method === "total-aggregate-delta")
    return { reason: "token-aggregate", explained: true };
  if (entry.v4Records.length === 0) return { reason: "v5-only", explained: false };
  if (entry.afterFork.length === 0) return { reason: "v4-only", explained: false };
  if (delta !== 0) return { reason: "usage-changed", explained: false };
  return { reason: "unexplained", explained: false };
};

const summaryFor = (entries: readonly CodexEventComparisonV5[]): CodexDeltaReasonSummary[] => reasons.map((reason) => {
  const selected = entries.filter((entry) => entry.reason === reason);
  const v4Tokens = selected.reduce((sum, entry) => sum + (entry.v4?.total ?? 0), 0);
  const v5Tokens = selected.reduce((sum, entry) => sum + entry.v5.totalAfterFork, 0);
  const delta = selected.reduce((sum, entry) => sum + entry.delta, 0);
  return { reason, events: selected.length, v4Tokens, v5Tokens, delta, explainedDelta: selected.filter((entry) => entry.explained).reduce((sum, entry) => sum + entry.delta, 0) };
});

const emptyExamples = (): Record<CodexV4V5DeltaReason, CodexEventComparisonV5[]> => Object.fromEntries(reasons.map((reason) => [reason, []])) as unknown as Record<CodexV4V5DeltaReason, CodexEventComparisonV5[]>;

export function compareCodexV4V5(
  files: readonly CodexExtractedFile[],
  options: CodexV4V5ComparatorOptions = {},
): CodexV4V5ComparisonReport {
  const v4 = replayCodexV4(files);
  const v5 = parseCodexFilesV5(codexExtractedFilesToV5Inputs(files));
  const entries = new Map<string, EntryAccumulator>();
  const sourceByKey = recordMetadataOf(files);
  for (const session of v5.sessions) {
    for (const contribution of session.canonicalBeforeForkReplay) addV5Contribution(entries, session.sessionId, contribution, "before");
    for (const contribution of session.canonicalAfterForkReplay) addV5Contribution(entries, session.sessionId, contribution, "after");
    for (const ref of session.tokenCountRefs) {
      const entry = ensureEntry(entries, session.sessionId, ref.event);
      entry.tokenRef = { method: ref.method, aggregateTotal: ref.aggregateTotal };
    }
    for (const fallback of session.payloadFallbacks) {
      const entry = ensureEntry(entries, session.sessionId, fallback.event);
      entry.payloadFallbacks.push(fallback);
    }
  }
  const mapping = buildV4Mapping(files, v4, entries);
  for (const entry of entries.values()) if (!entry.source) entry.source = sourceByKey.get(entry.key)?.source;
  const baselines = baselineResolutionMap(v5, files);
  const comparisonEntries: CodexEventComparisonV5[] = [...entries.values()].map((entry) => {
    const v4Usage = zeroUsage();
    for (const record of entry.v4Records) addUsage(v4Usage, record.usage);
    const beforeUsage = usageOf(entry.beforeFork);
    const afterUsage = usageOf(entry.afterFork);
    const classification = classify(entry, v4Usage, afterUsage, baselines);
    const timestamp = entry.timestamp ?? entry.afterFork[0]?.event.timestamp ?? entry.beforeFork[0]?.event.timestamp;
    return {
      key: entry.key,
      sessionId: entry.sessionId,
      rawIdentity: entry.rawIdentity,
      eventIndex: entry.eventIndex,
      timestamp,
      semanticType: entry.semanticType,
      v4: entry.v4Records.length > 0 ? {
        recordId: entry.v4Records.map((record) => record.id).join(","),
        sourceKind: entry.v4Records[0]!.sourceKind,
        usage: v4Usage,
        total: totalTokens(v4Usage),
      } : undefined,
      v5: {
        beforeFork: entry.beforeFork,
        afterFork: entry.afterFork,
        tokenRef: entry.tokenRef,
        payloadFallbacks: entry.payloadFallbacks,
        totalBeforeFork: totalTokens(beforeUsage),
        totalAfterFork: totalTokens(afterUsage),
      },
      delta: totalTokens(afterUsage) - totalTokens(v4Usage),
      componentDelta: subtractUsageSigned(afterUsage, v4Usage),
      reason: classification.reason,
      explained: classification.explained,
    };
  }).sort((left, right) => left.sessionId.localeCompare(right.sessionId) || left.eventIndex - right.eventIndex || left.key.localeCompare(right.key));
  const byReason = summaryFor(comparisonEntries);
  const explainedDelta = comparisonEntries.filter((entry) => entry.explained).reduce((sum, entry) => sum + entry.delta, 0);
  const unexplainedDelta = comparisonEntries.filter((entry) => !entry.explained).reduce((sum, entry) => sum + entry.delta, 0);
  const changedEntries = comparisonEntries.filter((entry) => entry.delta !== 0 || signedNonZero(entry.componentDelta));
  const unexplainedEntries = changedEntries.filter((entry) => !entry.explained);
  const sessionIds = [...new Set(comparisonEntries.map((entry) => entry.sessionId))].sort();
  const sessions = sessionIds.map((sessionId) => {
    const selected = comparisonEntries.filter((entry) => entry.sessionId === sessionId);
    const v4Records = selected.reduce((sum, entry) => sum + (entry.v4 ? 1 : 0), 0);
    const v5Contributions = selected.reduce((sum, entry) => sum + entry.v5.afterFork.length, 0);
    const v4Tokens = selected.reduce((sum, entry) => sum + (entry.v4?.total ?? 0), 0);
    const v5Tokens = selected.reduce((sum, entry) => sum + entry.v5.totalAfterFork, 0);
    return { sessionId, v4Records, v5Contributions, v4Tokens, v5Tokens, delta: v5Tokens - v4Tokens, reasons: summaryFor(selected), changedEvents: selected.filter((entry) => entry.delta !== 0 || signedNonZero(entry.componentDelta)).length, unexplainedEvents: selected.filter((entry) => !entry.explained && (entry.delta !== 0 || signedNonZero(entry.componentDelta))).length };
  });
  const canonicalUsage = zeroUsage();
  for (const session of v5.sessions) addUsage(canonicalUsage, usageOf(session.canonicalAfterForkReplay));
  const components = subtractUsageSigned(canonicalUsage, v4.usage);
  const sourceIntegrity = v5.diagnostics.activation.sourceIntegrity;
  const universe: CodexComparisonUniverse = {
    discoveredFiles: files.length,
    v4CanonicalFiles: v4.canonicalFileCount,
    v5LogicalSessions: v5.diagnostics.reconcile.logicalSessions,
    v5ExactDuplicateFiles: v5.diagnostics.reconcile.exactDuplicateFiles,
    v5PrefixShadowedFiles: v5.diagnostics.reconcile.prefixShadowedFiles,
    v5ConflictingLogicalSessions: v5.diagnostics.reconcile.conflictingLogicalSessions,
    v5OrphanFiles: v5.diagnostics.reconcile.orphanFiles,
    v4RecordMapping: mapping,
  };
  const v5ParserInvariants = Object.values(v5.diagnostics.invariants).every(Boolean);
  const universeComparable = universe.v5ConflictingLogicalSessions === 0 && universe.v5OrphanFiles === 0 && mapping.unmappedRecords === 0 && mapping.ambiguousRecords === 0;
  const accountingTokens = totalTokens(canonicalUsage) - totalTokens(v4.usage);
  const reasonDeltaSum = comparisonEntries.reduce((sum, entry) => sum + entry.delta, 0);
  const accountingBalanced = accountingTokens === reasonDeltaSum;
  const attributionComplete = unexplainedDelta === 0 && unexplainedEntries.length === 0;
  const gates: CodexV4V5ComparisonGates = {
    sourceIntegrity,
    universeComparable,
    v5ParserInvariants,
    v5Activation: v5.safeToActivate,
    v4MappingComplete: mapping.unmappedRecords === 0 && mapping.ambiguousRecords === 0,
    attributionComplete,
    accountingBalanced,
  };
  const limit = Math.max(0, options.detailLimit ?? 20);
  const examplesByReason = emptyExamples();
  for (const reason of reasons) examplesByReason[reason] = comparisonEntries.filter((entry) => entry.reason === reason).slice().sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.key.localeCompare(right.key)).slice(0, limit);
  return {
    comparatorVersion: 1,
    snapshot: { files: files.length },
    universe,
    v4: { recordCount: v4.recordCount, sessionCount: v4.sessionCount, usage: v4.usage, totalTokens: totalTokens(v4.usage) },
    v5: { canonicalContributions: v5.sessions.reduce((sum, session) => sum + session.canonicalAfterForkReplay.length, 0), emittedRecords: v5.diagnostics.projection.emittedRecords, canonicalUsage, canonicalTokens: totalTokens(canonicalUsage), emittedTokens: v5.diagnostics.projection.emittedTokens, safeToActivate: v5.safeToActivate },
    difference: { components, accountingTokens, projectionTokens: v5.diagnostics.projection.emittedTokens - totalTokens(canonicalUsage) },
    attribution: { byReason, explainedDelta, unexplainedDelta, changedEvents: changedEntries.length, unexplainedEvents: unexplainedEntries.length },
    sessions,
    largestAbsoluteSessionDelta: [...sessions].sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.sessionId.localeCompare(right.sessionId)).slice(0, 20),
    details: { unexplained: unexplainedEntries.slice(0, limit), largestChanges: [...changedEntries].sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.key.localeCompare(right.key)).slice(0, limit), examplesByReason },
    gates,
    readyForCollectorSwitch: Object.values(gates).every(Boolean),
    comparisonEntries,
  };
}
