import { totalTokens, zeroUsage, type TokenUsage } from "@lw-aiusage/core";
import { objectValue, stableEventId, stringValue, stableHash } from "../shared/identity";
import { rawCounterTotal } from "./accounting";
import type { CodexExtractedEvent, CodexExtractedFile, CodexUsageSource } from "./rawAuditTypes";
import { replayCodexV4 } from "./parserV4Mirror";
import { decodeCodexFileV5, stableCodexEventJsonV5, type CodexParsedFileInputV5 } from "./eventDecoderV5";
import { parseCodexFilesV5, type CodexV5ParseResult, type CodexV5SessionParseResult } from "./parserV5";
import { resolveForkBaselinesV5, resolveForkReplayV5, type CanonicalUsageContributionV5, type ForkBaselineResolutionV5, type ForkReplaySuppressionV5 } from "./forkReplayV5";
import { reconcileCodexLogicalSessionsV5, type CodexLogicalSessionConflictSummaryV5, type CodexLogicalSessionReconcileResultV5 } from "./logicalSessionV5";
import { deriveTokenCountContribution, type CodexAccountingEvent } from "./accountingV5";
import { payloadUsageCandidateOf, resolvePayloadFallbackV5, type PayloadSuppression } from "./payloadFallbackV5";
import type { ParserV4MirrorRecord } from "./rawAuditTypes";
import type { CodexV5ParserDiagnostics } from "./parserV5";

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
  | "mixed"
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

export type CodexAttributionSignalReason = Exclude<CodexV4V5DeltaReason, "same" | "mixed" | "v4-only" | "v5-only" | "usage-changed" | "unexplained">;

export interface CodexAttributionSignal {
  reason: CodexAttributionSignalReason;
  evidence: string;
  relatedRawIdentity?: string;
  relatedSessionId?: string;
  tokens?: number;
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
  signals: CodexAttributionSignal[];
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

export interface CodexRawContentDuplicateGroupV5 {
  sessionId: string;
  rawContentFingerprint: string;
  occurrences: number;
  eventIndexes: number[];
  timestamp?: number;
  /** Tokens represented by one occurrence, using the extracted per-event usage. */
  aggregateTokens: number;
  sourcePaths: string[];
  v5OnlyOccurrences: number;
  v5OnlyTokens: number;
  unexplainedOccurrences: number;
  unexplainedTokens: number;
}

export interface CodexRawContentDuplicateSummaryV5 {
  groups: number;
  duplicateOccurrences: number;
  candidateExtraTokens: number;
  v5OnlyOccurrences: number;
  v5OnlyTokens: number;
  unexplainedOccurrences: number;
  unexplainedTokens: number;
  examples: CodexRawContentDuplicateGroupV5[];
}

export interface CodexV5DiagnosticsSummary {
  source: Pick<CodexV5ParserDiagnostics["source"], "filesWithParseErrors" | "parseErrorCount" | "filesWithPendingText">;
  decode: Pick<CodexV5ParserDiagnostics["decode"], "sessionIdentityConflicts" | "parentIdentityConflicts">;
  reconcile: Pick<CodexV5ParserDiagnostics["reconcile"], "logicalSessions" | "exactDuplicateFiles" | "prefixShadowedFiles" | "conflictingLogicalSessions" | "orphanFiles"> & {
    conflicts: CodexLogicalSessionConflictSummaryV5[];
  };
  tokenCount: {
    observedEvents: number;
    exactRawDuplicateEvents: number;
    canonicalEvents: number;
    canonicalTokens: number;
    unresolved: number;
    counterResets: number;
    incomparable: number;
  };
  forkBaseline: Pick<CodexV5ParserDiagnostics["forkBaseline"],
    "forkSessions" | "missingParentSessions" | "missingForkTimestampSessions" |
    "missingParentCheckpointSessions" | "missingChildTotalTimestampSessions" |
    "incomparableBaselineSessions" | "cycleSessions" | "conflictingParentSessions">;
  forkReplay: Pick<CodexV5ParserDiagnostics["forkReplay"], "replayPrefixMismatchSessions" | "partialReplayBlockedEvents" | "missingReplayIdentityEvents">;
  projection: Pick<CodexV5ParserDiagnostics["projection"], "missingTimestampContributions" | "missingTimestampTokens">;
  invariants: CodexV5ParserDiagnostics["invariants"];
  activation: CodexV5ParserDiagnostics["activation"];
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
  comparatorVersion: 2;
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
    diagnostics: CodexV5DiagnosticsSummary;
  };
  conflicts: CodexLogicalSessionConflictSummaryV5[];
  rawContentDuplicates: CodexRawContentDuplicateSummaryV5;
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
    mixedEvents: number;
    mixedDelta: number;
    signalCounts: Record<CodexAttributionSignalReason, number>;
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
  "payload-suppression", "payload-fallback", "taxonomy-non-token-usage", "mixed", "v4-only",
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

const rawUsageOf = (event: CodexExtractedEvent): number =>
  rawCounterTotal(event.last ?? event.flat ?? event.total ?? {
    input: 0,
    cachedInput: 0,
    cacheCreationInput: 0,
    output: 0,
    reasoningOutput: 0,
    total: 0,
  });

const rawContentDuplicatesOf = (
  files: readonly CodexExtractedFile[],
  limit: number,
  comparisonEntries: readonly CodexEventComparisonV5[] = [],
): CodexRawContentDuplicateSummaryV5 => {
  const groups = new Map<string, CodexRawContentDuplicateGroupV5>();
  for (const file of files) {
    for (const event of file.events) {
      const aggregateTokens = rawUsageOf(event);
      if (aggregateTokens <= 0) continue;
      const sessionId = eventSessionId(file, event);
      const rawContentFingerprint = stableHash(stableCodexEventJsonV5(event.raw));
      const key = `${sessionId}\n${rawContentFingerprint}`;
      const current = groups.get(key);
      if (current) {
        current.occurrences += 1;
        current.eventIndexes.push(event.eventIndex);
        current.sourcePaths.push(file.entry.path);
        continue;
      }
      groups.set(key, {
        sessionId,
        rawContentFingerprint,
        occurrences: 1,
        eventIndexes: [event.eventIndex],
        timestamp: typeof event.raw.timestamp === "number" ? event.raw.timestamp : undefined,
        aggregateTokens,
        sourcePaths: [file.entry.path],
        v5OnlyOccurrences: 0,
        v5OnlyTokens: 0,
        unexplainedOccurrences: 0,
        unexplainedTokens: 0,
      });
    }
  }
  const duplicateGroups = [...groups.values()]
    .filter((group) => group.occurrences > 1)
    .map((group) => {
      const eventIndexes = [...group.eventIndexes].sort((left, right) => left - right);
      const relatedEntries = comparisonEntries.filter((entry) =>
        entry.sessionId === group.sessionId &&
        eventIndexes.includes(entry.eventIndex) &&
        entry.rawIdentity.endsWith(`:h${group.rawContentFingerprint}`));
      return {
        ...group,
        eventIndexes,
        sourcePaths: [...new Set(group.sourcePaths)].sort(),
        v5OnlyOccurrences: relatedEntries.filter((entry) => entry.reason === "v5-only").length,
        v5OnlyTokens: relatedEntries.filter((entry) => entry.reason === "v5-only").reduce((sum, entry) => sum + entry.v5.totalAfterFork, 0),
        unexplainedOccurrences: relatedEntries.filter((entry) => !entry.explained).length,
        unexplainedTokens: relatedEntries.filter((entry) => !entry.explained).reduce((sum, entry) => sum + entry.delta, 0),
      };
    })
    .sort((left, right) =>
      (right.aggregateTokens * (right.occurrences - 1)) - (left.aggregateTokens * (left.occurrences - 1)) ||
      left.sessionId.localeCompare(right.sessionId) ||
      left.rawContentFingerprint.localeCompare(right.rawContentFingerprint));
  return {
    groups: duplicateGroups.length,
    duplicateOccurrences: duplicateGroups.reduce((sum, group) => sum + group.occurrences - 1, 0),
    candidateExtraTokens: duplicateGroups.reduce((sum, group) => sum + group.aggregateTokens * (group.occurrences - 1), 0),
    v5OnlyOccurrences: duplicateGroups.reduce((sum, group) => sum + group.v5OnlyOccurrences, 0),
    v5OnlyTokens: duplicateGroups.reduce((sum, group) => sum + group.v5OnlyTokens, 0),
    unexplainedOccurrences: duplicateGroups.reduce((sum, group) => sum + group.unexplainedOccurrences, 0),
    unexplainedTokens: duplicateGroups.reduce((sum, group) => sum + group.unexplainedTokens, 0),
    examples: duplicateGroups.slice(0, limit),
  };
};

const v5DiagnosticsSummaryOf = (diagnostics: CodexV5ParserDiagnostics): CodexV5DiagnosticsSummary => ({
  source: {
    filesWithParseErrors: diagnostics.source.filesWithParseErrors,
    parseErrorCount: diagnostics.source.parseErrorCount,
    filesWithPendingText: diagnostics.source.filesWithPendingText,
  },
  decode: {
    sessionIdentityConflicts: diagnostics.decode.sessionIdentityConflicts,
    parentIdentityConflicts: diagnostics.decode.parentIdentityConflicts,
  },
  reconcile: {
    logicalSessions: diagnostics.reconcile.logicalSessions,
    exactDuplicateFiles: diagnostics.reconcile.exactDuplicateFiles,
    prefixShadowedFiles: diagnostics.reconcile.prefixShadowedFiles,
    conflictingLogicalSessions: diagnostics.reconcile.conflictingLogicalSessions,
    orphanFiles: diagnostics.reconcile.orphanFiles,
    conflicts: diagnostics.reconcile.conflicts.map((conflict) => ({
      sessionId: conflict.sessionId,
      reason: conflict.reason,
      sourcePaths: [...conflict.sourcePaths],
    })),
  },
  tokenCount: {
    observedEvents: diagnostics.tokenCount.observedEvents,
    exactRawDuplicateEvents: diagnostics.tokenCount.exactRawDuplicateEvents,
    canonicalEvents: diagnostics.tokenCount.canonicalEvents,
    canonicalTokens: diagnostics.tokenCount.canonicalTokens,
    unresolved: diagnostics.tokenCount.methods.unresolved,
    counterResets: diagnostics.tokenCount.counterResets,
    incomparable: diagnostics.tokenCount.incomparable,
  },
  forkBaseline: {
    forkSessions: diagnostics.forkBaseline.forkSessions,
    missingParentSessions: diagnostics.forkBaseline.missingParentSessions,
    missingForkTimestampSessions: diagnostics.forkBaseline.missingForkTimestampSessions,
    missingParentCheckpointSessions: diagnostics.forkBaseline.missingParentCheckpointSessions,
    missingChildTotalTimestampSessions: diagnostics.forkBaseline.missingChildTotalTimestampSessions,
    incomparableBaselineSessions: diagnostics.forkBaseline.incomparableBaselineSessions,
    cycleSessions: diagnostics.forkBaseline.cycleSessions,
    conflictingParentSessions: diagnostics.forkBaseline.conflictingParentSessions,
  },
  forkReplay: {
    replayPrefixMismatchSessions: diagnostics.forkReplay.replayPrefixMismatchSessions,
    partialReplayBlockedEvents: diagnostics.forkReplay.partialReplayBlockedEvents,
    missingReplayIdentityEvents: diagnostics.forkReplay.missingReplayIdentityEvents,
  },
  projection: {
    missingTimestampContributions: diagnostics.projection.missingTimestampContributions,
    missingTimestampTokens: diagnostics.projection.missingTimestampTokens,
  },
  invariants: { ...diagnostics.invariants },
  activation: { ...diagnostics.activation },
});

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

interface CodexComparatorEvidenceContext {
  decoded: ReturnType<typeof decodeCodexFileV5>[];
  reconciled: CodexLogicalSessionReconcileResultV5;
  baselines: Map<string, ForkBaselineResolutionV5>;
  forkReplaySuppressions: Map<string, ForkReplaySuppressionV5[]>;
  payloadSuppressions: Map<string, PayloadSuppression[]>;
}

const forkSourceOf = (session: CodexComparatorEvidenceContext["reconciled"]["sessions"][number]) => ({
  sessionId: session.sessionId,
  parentSessionId: session.parentSessionId,
  forkTimestamp: session.forkTimestamp,
  events: session.events,
});

const buildComparatorEvidenceContext = (
  files: readonly CodexExtractedFile[],
  v5: CodexV5ParseResult,
): CodexComparatorEvidenceContext => {
  const decoded = files.map((file) => decodeCodexFileV5({
    sourcePath: file.entry.path,
    logicalIdHint: file.peekLogicalId,
    values: file.events.map((event) => event.raw),
    parseErrors: file.parseErrors,
  }));
  const reconciled = reconcileCodexLogicalSessionsV5(decoded);
  const baselinePlan = resolveForkBaselinesV5(reconciled.sessions.map(forkSourceOf));
  const replay = resolveForkReplayV5(v5.sessions.map((session) => ({
    sessionId: session.sessionId,
    parentSessionId: session.parentSessionId,
    forkTimestamp: session.forkTimestamp,
    contributions: session.canonicalBeforeForkReplay,
  })));
  const forkReplaySuppressions = new Map<string, ForkReplaySuppressionV5[]>();
  for (const session of replay.sessions) for (const suppression of session.suppressed) {
    const key = comparisonEventKey(session.sessionId, suppression.child.event.rawIdentity);
    const list = forkReplaySuppressions.get(key) ?? [];
    list.push(suppression);
    forkReplaySuppressions.set(key, list);
  }
  const payloadSuppressions = new Map<string, PayloadSuppression[]>();
  const v5Sessions = new Map(v5.sessions.map((session) => [session.sessionId, session]));
  for (const logical of reconciled.sessions) {
    const session = v5Sessions.get(logical.sessionId);
    if (!session) continue;
    const payloads = logical.events.map(payloadUsageCandidateOf).filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate);
    const resolved = resolvePayloadFallbackV5(session.tokenCountRefs, payloads);
    for (const suppression of resolved.suppressed) {
      const key = comparisonEventKey(logical.sessionId, suppression.payload.event.rawIdentity);
      const list = payloadSuppressions.get(key) ?? [];
      list.push(suppression);
      payloadSuppressions.set(key, list);
    }
  }
  return { decoded, reconciled, baselines: baselinePlan.resolutions, forkReplaySuppressions, payloadSuppressions };
};

const collectAttributionSignals = (
  entry: EntryAccumulator,
  context: CodexComparatorEvidenceContext,
): CodexAttributionSignal[] => {
  const signals: CodexAttributionSignal[] = [];
  for (const suppression of context.forkReplaySuppressions.get(entry.key) ?? []) {
    signals.push({
      reason: "fork-replay",
      evidence: "matched-parent-prefix",
      relatedRawIdentity: suppression.parent.event.rawIdentity,
      relatedSessionId: suppression.parent.event.sessionId,
      tokens: suppression.suppressedTokens,
    });
  }
  const baseline = context.baselines.get(entry.sessionId);
  if (baseline?.status === "resolved" && baseline.firstChildTotalEvent?.rawIdentity === entry.rawIdentity) {
    const seeded = baseline.initialState
      ? deriveTokenCountContribution(baseline.firstChildTotalEvent, baseline.initialState)
      : undefined;
    const standalone = deriveTokenCountContribution(baseline.firstChildTotalEvent, { segment: 0 });
    if (seeded && standalone && !usageEqual(seeded.usage, standalone.usage)) {
      signals.push({
        reason: "fork-baseline",
        evidence: "seeded-contribution-differs",
        relatedRawIdentity: baseline.checkpoint?.event.rawIdentity,
        relatedSessionId: baseline.checkpoint?.parentSessionId,
        tokens: totalTokens(seeded.usage) - totalTokens(standalone.usage),
      });
    }
  }
  for (const suppression of context.payloadSuppressions.get(entry.key) ?? []) {
    signals.push({
      reason: "payload-suppression",
      evidence: suppression.evidence,
      relatedRawIdentity: suppression.token.event.rawIdentity,
      relatedSessionId: suppression.token.event.sessionId,
      tokens: suppression.suppressedTokens,
    });
  }
  const hasKeptPayloadFallback = entry.afterFork.some((contribution) => contribution.sourceKind === "payload-fallback");
  if (hasKeptPayloadFallback && entry.payloadFallbacks.length > 0) {
    signals.push({ reason: "payload-fallback", evidence: entry.payloadFallbacks.map((fallback) => fallback.reason).join(",") });
  }
  if (entry.source === "nested-info-non-token-count" && entry.v4Records.length > 0 && entry.afterFork.length === 0)
    signals.push({ reason: "taxonomy-non-token-usage", evidence: "v4-nested-info-on-non-token-count" });
  const hasKeptTokenCount = entry.afterFork.some((contribution) => contribution.sourceKind === "token-count");
  if (hasKeptTokenCount && entry.tokenRef?.method === "total-reset") signals.push({ reason: "token-reset", evidence: "token-count-method-total-reset" });
  if (hasKeptTokenCount && entry.tokenRef?.method === "total-aggregate-delta") signals.push({ reason: "token-aggregate", evidence: "token-count-method-total-aggregate-delta" });
  return signals;
};

const resolveAttribution = (
  entry: EntryAccumulator,
  v4Usage: TokenUsage,
  v5Usage: TokenUsage,
  signals: readonly CodexAttributionSignal[],
): { reason: CodexV4V5DeltaReason; explained: boolean } => {
  const changed = !usageEqual(v4Usage, v5Usage);
  if (!changed) return { reason: "same", explained: true };
  const signalReasons = [...new Set(signals.map((signal) => signal.reason))];
  if (signalReasons.length === 1) return { reason: signalReasons[0]!, explained: true };
  if (signalReasons.length > 1) return { reason: "mixed", explained: false };
  if (entry.v4Records.length === 0) return { reason: "v5-only", explained: false };
  if (entry.afterFork.length === 0) return { reason: "v4-only", explained: false };
  if (totalTokens(v4Usage) !== totalTokens(v5Usage)) return { reason: "usage-changed", explained: false };
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
  const evidence = buildComparatorEvidenceContext(files, v5);
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
  const comparisonEntries: CodexEventComparisonV5[] = [...entries.values()].map((entry) => {
    const v4Usage = zeroUsage();
    for (const record of entry.v4Records) addUsage(v4Usage, record.usage);
    const beforeUsage = usageOf(entry.beforeFork);
    const afterUsage = usageOf(entry.afterFork);
    const signals = collectAttributionSignals(entry, evidence);
    const classification = resolveAttribution(entry, v4Usage, afterUsage, signals);
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
      signals,
      reason: classification.reason,
      explained: classification.explained,
    };
  }).sort((left, right) => left.sessionId.localeCompare(right.sessionId) || left.eventIndex - right.eventIndex || left.key.localeCompare(right.key));
  const byReason = summaryFor(comparisonEntries);
  const explainedDelta = comparisonEntries.filter((entry) => entry.explained).reduce((sum, entry) => sum + entry.delta, 0);
  const unexplainedDelta = comparisonEntries.filter((entry) => !entry.explained).reduce((sum, entry) => sum + entry.delta, 0);
  const changedEntries = comparisonEntries.filter((entry) => entry.delta !== 0 || signedNonZero(entry.componentDelta));
  const unexplainedEntries = changedEntries.filter((entry) => !entry.explained);
  const signalCounts = Object.fromEntries(([
    "fork-baseline", "fork-replay", "token-reset", "token-aggregate",
    "payload-suppression", "payload-fallback", "taxonomy-non-token-usage",
  ] as CodexAttributionSignalReason[]).map((reason) => [
    reason,
    comparisonEntries.reduce((sum, entry) => sum + entry.signals.filter((signal) => signal.reason === reason).length, 0),
  ])) as Record<CodexAttributionSignalReason, number>;
  const mixedEntries = changedEntries.filter((entry) => entry.reason === "mixed");
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
  const v5Diagnostics = v5DiagnosticsSummaryOf(v5.diagnostics);
  const conflicts = v5Diagnostics.reconcile.conflicts;
  const rawContentDuplicates = rawContentDuplicatesOf(files, limit, comparisonEntries);
  const examplesByReason = emptyExamples();
  for (const reason of reasons) examplesByReason[reason] = comparisonEntries.filter((entry) => entry.reason === reason).slice().sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.key.localeCompare(right.key)).slice(0, limit);
  return {
    comparatorVersion: 2,
    snapshot: { files: files.length },
    universe,
    v4: { recordCount: v4.recordCount, sessionCount: v4.sessionCount, usage: v4.usage, totalTokens: totalTokens(v4.usage) },
    v5: {
      canonicalContributions: v5.sessions.reduce((sum, session) => sum + session.canonicalAfterForkReplay.length, 0),
      emittedRecords: v5.diagnostics.projection.emittedRecords,
      canonicalUsage,
      canonicalTokens: totalTokens(canonicalUsage),
      emittedTokens: v5.diagnostics.projection.emittedTokens,
      safeToActivate: v5.safeToActivate,
      diagnostics: v5Diagnostics,
    },
    conflicts,
    rawContentDuplicates,
    difference: { components, accountingTokens, projectionTokens: v5.diagnostics.projection.emittedTokens - totalTokens(canonicalUsage) },
    attribution: {
      byReason,
      explainedDelta,
      unexplainedDelta,
      changedEvents: changedEntries.length,
      unexplainedEvents: unexplainedEntries.length,
      mixedEvents: mixedEntries.length,
      mixedDelta: mixedEntries.reduce((sum, entry) => sum + entry.delta, 0),
      signalCounts,
    },
    sessions,
    largestAbsoluteSessionDelta: [...sessions].sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.sessionId.localeCompare(right.sessionId)).slice(0, 20),
    details: { unexplained: unexplainedEntries.slice(0, limit), largestChanges: [...changedEntries].sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.key.localeCompare(right.key)).slice(0, limit), examplesByReason },
    gates,
    readyForCollectorSwitch: Object.values(gates).every(Boolean),
    comparisonEntries,
  };
}
