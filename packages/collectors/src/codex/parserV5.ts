import { totalTokens, type UsageRecord } from "@lw-aiusage/core";
import {
  canonicalTokenCountRefOf,
  payloadUsageCandidateOf,
  resolvePayloadFallbackV5,
  type CanonicalTokenCountRef,
  type PayloadFallbackContribution,
  type PayloadFallbackDiagnostics,
} from "./payloadFallbackV5";
import {
  canonicalUsageFromPayloadFallback,
  canonicalUsageFromTokenCount,
  resolveForkBaselinesV5,
  resolveForkReplayV5,
  type CanonicalUsageContributionV5,
  type ForkBaselineDiagnosticsV5,
  type ForkCanonicalSessionV5,
  type ForkReplayDiagnosticsV5,
  type ForkReplaySessionResultV5,
  type ForkSessionSourceV5,
} from "./forkReplayV5";
import {
  deduplicateTokenCountEvents,
  deriveTokenCountContribution,
  deterministicAccountingTimestamp,
  type CodexAccountingEvent,
  type TokenCountAccountingMethod,
  type TokenCountState,
} from "./accountingV5";
import {
  resolveTokenCountDuplicatesV5,
  type CodexTokenCountDuplicateEvidenceSummary,
} from "./tokenCountDuplicateV5";
import { decodeCodexFileV5, type CodexDecodedFileV5, type CodexParsedFileInputV5, type CodexV5DecodeDiagnostics } from "./eventDecoderV5";
import {
  reconcileCodexLogicalSessionsV5,
  type CodexLogicalSessionReconcileDiagnosticsV5,
  type CodexLogicalSessionV5,
} from "./logicalSessionV5";

export type { CodexParsedFileInputV5 } from "./eventDecoderV5";

export interface CodexV5SessionParseResult {
  sessionId: string;
  sourcePath: string;
  parentSessionId?: string;
  forkTimestamp?: number;
  tokenCountRefs: CanonicalTokenCountRef[];
  payloadFallbacks: PayloadFallbackContribution[];
  canonicalBeforeForkReplay: CanonicalUsageContributionV5[];
  canonicalAfterForkReplay: CanonicalUsageContributionV5[];
  finalTokenCount: number;
}

export interface CodexV5TokenCountDiagnostics {
  observedEvents: number;
  exactRawDuplicateEvents: number;
  canonicalEvents: number;
  canonicalTokens: number;
  methods: {
    last: number;
    totalInitial: number;
    totalDelta: number;
    totalAggregateDelta: number;
    totalReset: number;
    duplicateZero: number;
    unresolved: number;
  };
  counterResets: number;
  componentConsistencyMismatch: number;
  incomparable: number;
  repeatedTotalWithNonZeroLast: number;
  duplicateEvidence: CodexTokenCountDuplicateEvidenceSummary;
  rawIdentityDuplicateEvents: number;
  exactRawContentDuplicateEvents: number;
  semanticDuplicateCandidates: number;
  suppressedDuplicateEvents: number;
  suppressedDuplicateTokens: number;
  duplicateConflicts: number;
}

export interface CodexV5ProjectionDiagnostics {
  keptCanonicalContributions: number;
  keptCanonicalTokens: number;
  emittedRecords: number;
  emittedTokens: number;
  missingTimestampContributions: number;
  missingTimestampTokens: number;
  unknownModelRecords: number;
  unknownModelTokens: number;
  unknownProjectRecords: number;
  unknownProjectTokens: number;
  duplicateRecordIds: number;
}

export interface CodexV5SourceIntegrityDiagnostics {
  files: number;
  filesWithParseErrors: number;
  parseErrorCount: number;
  filesWithPendingText: number;
}

export interface CodexV5ParserInvariants {
  logicalSessionReconciliation: boolean;
  tokenCountDuplicateEvent: boolean;
  payloadEvent: boolean;
  payloadToken: boolean;
  forkContribution: boolean;
  forkToken: boolean;
  projectionContribution: boolean;
  projectionToken: boolean;
  uniqueRecordIds: boolean;
}

export interface CodexV5ActivationGates {
  sourceIntegrity: boolean;
  sessionIdentity: boolean;
  timestampCompleteness: boolean;
  tokenCountCompleteness: boolean;
  forkResolution: boolean;
}

export interface CodexV5ParserDiagnostics {
  decode: CodexV5DecodeDiagnostics;
  source: CodexV5SourceIntegrityDiagnostics;
  reconcile: CodexLogicalSessionReconcileDiagnosticsV5;
  tokenCount: CodexV5TokenCountDiagnostics;
  payload: PayloadFallbackDiagnostics;
  forkBaseline: ForkBaselineDiagnosticsV5;
  forkReplay: ForkReplayDiagnosticsV5;
  projection: CodexV5ProjectionDiagnostics;
  invariants: CodexV5ParserInvariants;
  activation: CodexV5ActivationGates;
}

export interface CodexV5ParseResult {
  records: UsageRecord[];
  sessions: CodexV5SessionParseResult[];
  diagnostics: CodexV5ParserDiagnostics;
  safeToActivate: boolean;
}

interface AccountSessionResult {
  session: CodexLogicalSessionV5;
  tokenCountRefs: CanonicalTokenCountRef[];
  payloadFallbacks: PayloadFallbackContribution[];
  canonical: CanonicalUsageContributionV5[];
  payloadDiagnostics: PayloadFallbackDiagnostics;
  payloadEventInvariant: boolean;
  payloadTokenInvariant: boolean;
}

const emptyTokenDiagnostics = (): CodexV5TokenCountDiagnostics => ({
  observedEvents: 0,
  exactRawDuplicateEvents: 0,
  canonicalEvents: 0,
  canonicalTokens: 0,
  methods: {
    last: 0,
    totalInitial: 0,
    totalDelta: 0,
    totalAggregateDelta: 0,
    totalReset: 0,
    duplicateZero: 0,
    unresolved: 0,
  },
  counterResets: 0,
  componentConsistencyMismatch: 0,
  incomparable: 0,
  repeatedTotalWithNonZeroLast: 0,
  duplicateEvidence: {
    candidatePairs: 0,
    confirmedPairs: 0,
    strongPairs: 0,
    probablePairs: 0,
    conflictPairs: 0,
    insufficientPairs: 0,
    confirmedCandidateTokens: 0,
    strongCandidateTokens: 0,
    probableCandidateTokens: 0,
    unresolvedCandidateTokens: 0,
    transition: { primaryOnly: 0, candidateOnly: 0, both: 0, neither: 0, reset: 0, incomparable: 0, insufficient: 0 },
    confirmedSuppressionTokens: 0,
    strongSuppressionCandidateTokens: 0,
    probablePrimaryTokens: 0,
    representativeChoiceDelta: 0,
    examples: [],
  },
  rawIdentityDuplicateEvents: 0,
  exactRawContentDuplicateEvents: 0,
  semanticDuplicateCandidates: 0,
  suppressedDuplicateEvents: 0,
  suppressedDuplicateTokens: 0,
  duplicateConflicts: 0,
});

const mergeDuplicateEvidence = (
  target: CodexTokenCountDuplicateEvidenceSummary,
  source: CodexTokenCountDuplicateEvidenceSummary,
): void => {
  target.candidatePairs += source.candidatePairs;
  target.confirmedPairs += source.confirmedPairs;
  target.strongPairs += source.strongPairs;
  target.probablePairs += source.probablePairs;
  target.conflictPairs += source.conflictPairs;
  target.insufficientPairs += source.insufficientPairs;
  target.confirmedCandidateTokens += source.confirmedCandidateTokens;
  target.strongCandidateTokens += source.strongCandidateTokens;
  target.probableCandidateTokens += source.probableCandidateTokens;
  target.unresolvedCandidateTokens += source.unresolvedCandidateTokens;
  target.transition.primaryOnly += source.transition.primaryOnly;
  target.transition.candidateOnly += source.transition.candidateOnly;
  target.transition.both += source.transition.both;
  target.transition.neither += source.transition.neither;
  target.transition.reset += source.transition.reset;
  target.transition.incomparable += source.transition.incomparable;
  target.transition.insufficient += source.transition.insufficient;
  target.confirmedSuppressionTokens += source.confirmedSuppressionTokens;
  target.strongSuppressionCandidateTokens += source.strongSuppressionCandidateTokens;
  target.probablePrimaryTokens += source.probablePrimaryTokens;
  target.probableCandidateTokens += source.probableCandidateTokens;
  target.representativeChoiceDelta += source.representativeChoiceDelta;
  target.examples.push(...source.examples);
}

const payloadDiagnosticKeys: (keyof PayloadFallbackDiagnostics)[] = [
  "observedPayloadEvents",
  "observedPayloadTokens",
  "exactRawDuplicateEvents",
  "exactRawDuplicateTokens",
  "confirmedSuppressedEvents",
  "confirmedSuppressedTokens",
  "sameRawEventSuppressedEvents",
  "sameResponseSuppressedEvents",
  "fallbackEvents",
  "fallbackTokens",
  "conflictEvents",
  "ambiguousEvents",
  "unmatchedEvents",
  "zeroEvents",
  "componentConsistencyMismatchEvents",
  "sameResponseDifferentUsageEvents",
  "sameResponseSameTotalDifferentComponentsEvents",
  "modelConflictEvents",
  "insufficientPrecisionEvents",
];

const addPayloadDiagnostics = (target: PayloadFallbackDiagnostics, source: PayloadFallbackDiagnostics): void => {
  for (const key of payloadDiagnosticKeys) target[key] += source[key];
};

const emptyPayloadDiagnostics = (): PayloadFallbackDiagnostics => resolvePayloadFallbackV5([], []).diagnostics;

const eventOrder = (left: CodexAccountingEvent, right: CodexAccountingEvent): number =>
  left.eventIndex - right.eventIndex || left.rawIdentity.localeCompare(right.rawIdentity);

const canonicalOrder = (left: CanonicalUsageContributionV5, right: CanonicalUsageContributionV5): number =>
  eventOrder(left.event, right.event) ||
  (left.sourceKind === "token-count" ? 0 : 1) - (right.sourceKind === "token-count" ? 0 : 1);

const incrementMethod = (diagnostics: CodexV5TokenCountDiagnostics, method: TokenCountAccountingMethod): void => {
  if (method === "last") diagnostics.methods.last += 1;
  else if (method === "total-initial") diagnostics.methods.totalInitial += 1;
  else if (method === "total-delta") diagnostics.methods.totalDelta += 1;
  else if (method === "total-aggregate-delta") diagnostics.methods.totalAggregateDelta += 1;
  else if (method === "total-reset") diagnostics.methods.totalReset += 1;
  else if (method === "duplicate-zero") diagnostics.methods.duplicateZero += 1;
  else diagnostics.methods.unresolved += 1;
};

const accountLogicalSession = (
  session: CodexLogicalSessionV5,
  baseline: ReturnType<typeof resolveForkBaselinesV5>,
  tokenDiagnostics: CodexV5TokenCountDiagnostics,
): AccountSessionResult => {
  const baselineResolution = baseline.resolutions.get(session.sessionId);
  let state: TokenCountState = baselineResolution?.status === "resolved" && baselineResolution.initialState
    ? { ...baselineResolution.initialState }
    : { segment: 0 };
  const tokenEvents = [...session.events]
    .filter((event) => !!event.tokenCount)
    .sort(eventOrder);
  const deduplicated = deduplicateTokenCountEvents(tokenEvents);
  const duplicateResolution = resolveTokenCountDuplicatesV5(deduplicated.events);
  mergeDuplicateEvidence(tokenDiagnostics.duplicateEvidence, duplicateResolution.summary);
  tokenDiagnostics.observedEvents += tokenEvents.length;
  tokenDiagnostics.exactRawDuplicateEvents += deduplicated.exactDuplicateCount;
  tokenDiagnostics.rawIdentityDuplicateEvents += deduplicated.exactDuplicateCount;
  tokenDiagnostics.exactRawContentDuplicateEvents += duplicateResolution.diagnostics.exactRawContentDuplicateEvents;
  tokenDiagnostics.semanticDuplicateCandidates += duplicateResolution.diagnostics.semanticDuplicateCandidates;
  tokenDiagnostics.suppressedDuplicateEvents += duplicateResolution.diagnostics.suppressedDuplicateEvents;
  tokenDiagnostics.suppressedDuplicateTokens += duplicateResolution.diagnostics.suppressedDuplicateTokens;
  tokenDiagnostics.duplicateConflicts += duplicateResolution.diagnostics.duplicateConflicts;
  const tokenCountRefs: CanonicalTokenCountRef[] = [];
  for (const event of duplicateResolution.events) {
    const contribution = deriveTokenCountContribution(event, state);
    if (!contribution) continue;
    state = contribution.nextState;
    incrementMethod(tokenDiagnostics, contribution.method);
    if (contribution.diagnostics.counterReset) tokenDiagnostics.counterResets += 1;
    if (contribution.diagnostics.componentConsistencyMismatch) tokenDiagnostics.componentConsistencyMismatch += 1;
    if (contribution.diagnostics.incomparable) tokenDiagnostics.incomparable += 1;
    if (contribution.diagnostics.repeatedTotalWithNonZeroLast) tokenDiagnostics.repeatedTotalWithNonZeroLast += 1;
    const ref = canonicalTokenCountRefOf(event, contribution);
    if (ref) tokenCountRefs.push(ref);
  }
  tokenDiagnostics.canonicalEvents += duplicateResolution.events.length;
  tokenDiagnostics.canonicalTokens += tokenCountRefs.reduce((sum, ref) => sum + ref.aggregateTotal, 0);
  const payloads = session.events.map(payloadUsageCandidateOf).filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate);
  const payloadResult = resolvePayloadFallbackV5(tokenCountRefs, payloads);
  const tokenCanonical = tokenCountRefs.map(canonicalUsageFromTokenCount);
  const payloadCanonical = payloadResult.fallbacks.map(canonicalUsageFromPayloadFallback);
  return {
    session,
    tokenCountRefs,
    payloadFallbacks: payloadResult.fallbacks,
    canonical: [...tokenCanonical, ...payloadCanonical].sort(canonicalOrder),
    payloadDiagnostics: payloadResult.diagnostics,
    payloadEventInvariant: payloadResult.payloadEventInvariant,
    payloadTokenInvariant: payloadResult.payloadTokenInvariant,
  };
};

const emptyProjectionDiagnostics = (): CodexV5ProjectionDiagnostics => ({
  keptCanonicalContributions: 0,
  keptCanonicalTokens: 0,
  emittedRecords: 0,
  emittedTokens: 0,
  missingTimestampContributions: 0,
  missingTimestampTokens: 0,
  unknownModelRecords: 0,
  unknownModelTokens: 0,
  unknownProjectRecords: 0,
  unknownProjectTokens: 0,
  duplicateRecordIds: 0,
});

const sourceIntegrityDiagnostics = (
  files: readonly CodexDecodedFileV5[],
): CodexV5SourceIntegrityDiagnostics => {
  let filesWithParseErrors = 0;
  let parseErrorCount = 0;
  let filesWithPendingText = 0;
  for (const file of files) {
    if (file.parseErrors.length > 0) {
      filesWithParseErrors += 1;
      parseErrorCount += file.parseErrors.length;
    }
    if (file.hasPendingText) filesWithPendingText += 1;
  }
  return { files: files.length, filesWithParseErrors, parseErrorCount, filesWithPendingText };
};

const buildActivationGates = (
  source: CodexV5SourceIntegrityDiagnostics,
  decode: CodexV5DecodeDiagnostics,
  tokenCount: CodexV5TokenCountDiagnostics,
  baseline: ForkBaselineDiagnosticsV5,
  replay: ForkReplayDiagnosticsV5,
  projection: CodexV5ProjectionDiagnostics,
): CodexV5ActivationGates => ({
  sourceIntegrity: source.parseErrorCount === 0 && source.filesWithPendingText === 0,
  sessionIdentity: decode.sessionIdentityConflicts === 0 && decode.parentIdentityConflicts === 0,
  timestampCompleteness: projection.missingTimestampContributions === 0 && projection.missingTimestampTokens === 0,
  tokenCountCompleteness: tokenCount.methods.unresolved === 0 && tokenCount.duplicateConflicts === 0,
  forkResolution: baseline.missingParentSessions === 0 &&
    baseline.missingForkTimestampSessions === 0 &&
    baseline.missingParentCheckpointSessions === 0 &&
    baseline.missingChildTotalTimestampSessions === 0 &&
    baseline.incomparableBaselineSessions === 0 &&
    baseline.cycleSessions === 0 &&
    baseline.conflictingParentSessions === 0 &&
    replay.replayPrefixMismatchSessions === 0,
});

const projectUsageRecordsV5 = (
  replaySessions: readonly ForkReplaySessionResultV5[],
): { records: UsageRecord[]; diagnostics: CodexV5ProjectionDiagnostics; contributionInvariant: boolean; tokenInvariant: boolean } => {
  const diagnostics = emptyProjectionDiagnostics();
  const records: UsageRecord[] = [];
  const ids = new Set<string>();
  for (const session of replaySessions) {
    const contributions = [...session.kept].sort(canonicalOrder);
    diagnostics.keptCanonicalContributions += contributions.length;
    diagnostics.keptCanonicalTokens += contributions.reduce((sum, contribution) => sum + contribution.aggregateTotal, 0);
    const slots = new Map<string, number>();
    for (const contribution of contributions) {
      const timestamp = deterministicAccountingTimestamp(contribution.event);
      if (timestamp === undefined) {
        diagnostics.missingTimestampContributions += 1;
        diagnostics.missingTimestampTokens += contribution.aggregateTotal;
        continue;
      }
      const model = contribution.event.model ?? "unknown";
      const projectKey = contribution.event.projectKey ?? "unknown";
      if (!contribution.event.model) {
        diagnostics.unknownModelRecords += 1;
        diagnostics.unknownModelTokens += contribution.aggregateTotal;
      }
      if (!contribution.event.projectKey) {
        diagnostics.unknownProjectRecords += 1;
        diagnostics.unknownProjectTokens += contribution.aggregateTotal;
      }
      const slot = slots.get(contribution.event.rawIdentity) ?? 0;
      slots.set(contribution.event.rawIdentity, slot + 1);
      const id = `codex:v5:${encodeURIComponent(session.sessionId)}:${contribution.event.rawIdentity}:${slot}`;
      if (ids.has(id)) diagnostics.duplicateRecordIds += 1;
      ids.add(id);
      records.push({
        id,
        source: "codex",
        sourcePath: contribution.event.sourcePath,
        sessionId: session.sessionId,
        timestamp,
        model,
        rawModel: contribution.event.model,
        projectKey,
        usage: contribution.usage,
      });
      diagnostics.emittedRecords += 1;
      diagnostics.emittedTokens += contribution.aggregateTotal;
    }
  }
  records.sort((left, right) =>
    (left.sessionId ?? "").localeCompare(right.sessionId ?? "") ||
    left.timestamp - right.timestamp ||
    left.id.localeCompare(right.id));
  const contributionInvariant = diagnostics.keptCanonicalContributions === diagnostics.emittedRecords + diagnostics.missingTimestampContributions;
  const tokenInvariant = diagnostics.keptCanonicalTokens === diagnostics.emittedTokens + diagnostics.missingTimestampTokens;
  return { records, diagnostics, contributionInvariant, tokenInvariant };
};

const sumDecodeDiagnostics = (files: readonly CodexDecodedFileV5[]): CodexV5DecodeDiagnostics => {
  const result: CodexV5DecodeDiagnostics = {
    tokenCountEvents: 0,
    payloadUsageEvents: 0,
    legacyFlatUsageEvents: 0,
    nestedUsageOnNonTokenEvents: 0,
    missingTimestampEvents: 0,
    sessionMetaEvents: 0,
    sessionIdentityConflicts: 0,
    parentIdentityConflicts: 0,
  };
  for (const file of files) {
    for (const key of Object.keys(result) as (keyof CodexV5DecodeDiagnostics)[]) result[key] += file.diagnostics[key];
  }
  return result;
};

const forkSourceOf = (session: CodexLogicalSessionV5): ForkSessionSourceV5 => ({
  sessionId: session.sessionId,
  parentSessionId: session.parentSessionId,
  forkTimestamp: session.forkTimestamp,
  events: session.events,
});

const canonicalSessionOf = (accounted: AccountSessionResult): ForkCanonicalSessionV5 => ({
  sessionId: accounted.session.sessionId,
  parentSessionId: accounted.session.parentSessionId,
  forkTimestamp: accounted.session.forkTimestamp,
  contributions: accounted.canonical,
});

export function parseCodexFilesV5(
  inputs: readonly CodexParsedFileInputV5[],
): CodexV5ParseResult {
  const decoded = inputs.map(decodeCodexFileV5);
  const reconciled = reconcileCodexLogicalSessionsV5(decoded);
  const baselinePlan = resolveForkBaselinesV5(reconciled.sessions.map(forkSourceOf));
  const tokenDiagnostics = emptyTokenDiagnostics();
  const payloadDiagnostics = emptyPayloadDiagnostics();
  const accounted = reconciled.sessions.map((session) => {
    const result = accountLogicalSession(session, baselinePlan, tokenDiagnostics);
    addPayloadDiagnostics(payloadDiagnostics, result.payloadDiagnostics);
    return result;
  });
  const replay = resolveForkReplayV5(accounted.map(canonicalSessionOf));
  const projection = projectUsageRecordsV5(replay.sessions);
  const replayBySession = new Map(replay.sessions.map((result) => [result.sessionId, result]));
  const sessions = accounted.map((result): CodexV5SessionParseResult => {
    const replayResult = replayBySession.get(result.session.sessionId);
    const kept = replayResult?.kept ?? result.canonical;
    return {
      sessionId: result.session.sessionId,
      sourcePath: result.session.sourcePath,
      parentSessionId: result.session.parentSessionId,
      forkTimestamp: result.session.forkTimestamp,
      tokenCountRefs: result.tokenCountRefs,
      payloadFallbacks: result.payloadFallbacks,
      canonicalBeforeForkReplay: result.canonical,
      canonicalAfterForkReplay: kept,
      finalTokenCount: kept.reduce((sum, contribution) => sum + contribution.aggregateTotal, 0),
    };
  });
  const invariants: CodexV5ParserInvariants = {
    logicalSessionReconciliation: reconciled.conflicts.length === 0 && reconciled.orphanFiles.length === 0,
    tokenCountDuplicateEvent: tokenDiagnostics.observedEvents ===
      tokenDiagnostics.canonicalEvents +
      tokenDiagnostics.rawIdentityDuplicateEvents +
      tokenDiagnostics.exactRawContentDuplicateEvents,
    payloadEvent: accounted.every((result) => result.payloadEventInvariant),
    payloadToken: accounted.every((result) => result.payloadTokenInvariant),
    forkContribution: replay.contributionInvariant,
    forkToken: replay.tokenInvariant,
    projectionContribution: projection.contributionInvariant,
    projectionToken: projection.tokenInvariant,
    uniqueRecordIds: projection.diagnostics.duplicateRecordIds === 0,
  };
  const decodeDiagnostics = sumDecodeDiagnostics(decoded);
  const sourceDiagnostics = sourceIntegrityDiagnostics(decoded);
  const activation = buildActivationGates(
    sourceDiagnostics,
    decodeDiagnostics,
    tokenDiagnostics,
    baselinePlan.diagnostics,
    replay.diagnostics,
    projection.diagnostics,
  );
  const diagnostics: CodexV5ParserDiagnostics = {
    decode: decodeDiagnostics,
    source: sourceDiagnostics,
    reconcile: reconciled.diagnostics,
    tokenCount: tokenDiagnostics,
    payload: payloadDiagnostics,
    forkBaseline: baselinePlan.diagnostics,
    forkReplay: replay.diagnostics,
    projection: projection.diagnostics,
    invariants,
    activation,
  };
  const safeToActivate = Object.values(invariants).every(Boolean) && Object.values(activation).every(Boolean);
  return { records: projection.records, sessions, diagnostics, safeToActivate };
}
