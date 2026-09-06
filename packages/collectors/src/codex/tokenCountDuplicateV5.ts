import { totalTokens, type TokenUsage } from "@lw-aiusage/core";
import {
  compareRawCumulative,
  effectiveAggregateTotal,
  normalizeRawTokenUsage,
  rawTokenUsageExactEqual,
  type TokenCountState,
  type CodexAccountingEvent,
  type RawTokenUsage,
} from "./accountingV5";

export type TokenCountDuplicateEvidenceKind =
  | "exact-raw-content"
  | "same-semantic-content"
  | "same-cumulative-snapshot"
  | "representation-pair"
  | "explicit-conflict"
  | "insufficient";

export type TokenCountDuplicateConfidence = "confirmed" | "strong" | "probable" | "insufficient" | "conflict";

export type TokenCountUsagePrecision = "component-exact" | "aggregate-only" | "component-inconsistent" | "missing";
export type TokenCountTransitionClassification = "primary-only" | "candidate-only" | "both" | "neither" | "reset" | "incomparable" | "insufficient";

export interface TokenCountDuplicateEvidenceV5 {
  sessionId: string;
  primaryRawIdentity: string;
  candidateRawIdentity: string;
  primaryEventIndex: number;
  candidateEventIndex: number;
  kind: TokenCountDuplicateEvidenceKind;
  sameTimestamp: boolean;
  sameRawContent: boolean;
  sameSemanticContent: boolean;
  sameCumulativeSnapshot: boolean;
  responseIdCompatible: boolean;
  turnIdCompatible: boolean;
  modelCompatible: boolean;
  primaryUsage: TokenUsage;
  candidateUsage: TokenUsage;
  primaryTokens: number;
  candidateTokens: number;
  confidence: TokenCountDuplicateConfidence;
  suppressible: false;
  reason: string;
  previousCumulative?: RawTokenUsage;
  currentCumulative?: RawTokenUsage;
  transitionUsage?: TokenUsage;
  transitionTokens?: number;
  primaryMatchesTransition: boolean;
  candidateMatchesTransition: boolean;
  transitionClassification: TokenCountTransitionClassification;
  semanticDiffPaths: string[];
}

export interface CodexTokenCountDuplicateEvidenceSummary {
  candidatePairs: number;
  confirmedPairs: number;
  strongPairs: number;
  probablePairs: number;
  conflictPairs: number;
  insufficientPairs: number;
  confirmedCandidateTokens: number;
  strongCandidateTokens: number;
  probableCandidateTokens: number;
  unresolvedCandidateTokens: number;
  transition: {
    primaryOnly: number;
    candidateOnly: number;
    both: number;
    neither: number;
    reset: number;
    incomparable: number;
    insufficient: number;
  };
  confirmedSuppressionTokens: number;
  strongSuppressionCandidateTokens: number;
  probablePrimaryTokens: number;
  representativeChoiceDelta: number;
  examples: TokenCountDuplicateEvidenceV5[];
}

export interface TokenCountSuppressionV5 {
  sessionId: string;
  representativeRawIdentity: string;
  suppressedRawIdentity: string;
  kind: "exact-raw-content" | "semantic-snapshot";
  confidence: "confirmed" | "strong";
  suppressedUsage: TokenUsage;
  suppressedTokens: number;
}

export interface TokenCountDuplicateDiagnosticsV5 {
  exactRawContentDuplicateEvents: number;
  semanticDuplicateCandidates: number;
  suppressedDuplicateEvents: number;
  suppressedDuplicateTokens: number;
  duplicateConflicts: number;
}

export interface TokenCountDuplicateResolutionV5 {
  events: readonly CodexAccountingEvent[];
  evidence: readonly TokenCountDuplicateEvidenceV5[];
  suppressed: readonly TokenCountSuppressionV5[];
  diagnostics: TokenCountDuplicateDiagnosticsV5;
  summary: CodexTokenCountDuplicateEvidenceSummary;
  safe: boolean;
}

export interface TokenCountDuplicateEvidenceOptions {
  detailLimit?: number;
}

interface UsagePrecision {
  kind: TokenCountUsagePrecision;
  componentFields: number;
  hasInputOutput: boolean;
  hasAggregate: boolean;
  aggregateConsistent: boolean;
}

const emptySummary = (): CodexTokenCountDuplicateEvidenceSummary => ({
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
});

const sessionOf = (event: CodexAccountingEvent): string => event.sessionId ?? event.sourcePath;
const eventIdentity = (event: CodexAccountingEvent): string => `${event.sourcePath}\n${event.eventIndex}\n${event.rawIdentity}`;
const eventOrder = (left: CodexAccountingEvent, right: CodexAccountingEvent): number =>
  left.eventIndex - right.eventIndex || left.sourcePath.localeCompare(right.sourcePath) || left.rawIdentity.localeCompare(right.rawIdentity);

const rawFingerprintOf = (event: CodexAccountingEvent): string | undefined => {
  if (event.rawContentFingerprint) return event.rawContentFingerprint;
  const match = /:h([^:]+)$/.exec(event.rawIdentity);
  return match?.[1];
};

const usageRawOf = (event: CodexAccountingEvent): RawTokenUsage | undefined => event.tokenCount?.last ?? event.tokenCount?.total;

const usageOf = (raw: RawTokenUsage | undefined): TokenUsage => raw ? normalizeRawTokenUsage(raw) : {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
};

const tokensOf = (event: CodexAccountingEvent): number => {
  const raw = usageRawOf(event);
  return raw ? effectiveAggregateTotal(raw) ?? totalTokens(usageOf(raw)) : 0;
};

const optionalIdentityCompatible = (left?: string, right?: string): boolean => !left || !right || left === right;
const positivelyMatched = (left?: string, right?: string): boolean => !!left && !!right && left === right;

const usagePrecisionOf = (event: CodexAccountingEvent): UsagePrecision => {
  const raw = usageRawOf(event);
  if (!raw) return { kind: "missing", componentFields: 0, hasInputOutput: false, hasAggregate: false, aggregateConsistent: false };
  const hasInputOutput = raw.fieldPresence.input && raw.fieldPresence.output;
  const hasAggregate = raw.fieldPresence.total;
  const componentFields = [raw.fieldPresence.input, raw.fieldPresence.cachedInput, raw.fieldPresence.cacheCreationInput, raw.fieldPresence.output, raw.fieldPresence.reasoningOutput]
    .filter(Boolean).length;
  const aggregateConsistent = hasAggregate && hasInputOutput && totalTokens(normalizeRawTokenUsage(raw)) === raw.total;
  return {
    kind: !hasInputOutput ? (hasAggregate ? "aggregate-only" : "missing") : hasAggregate && !aggregateConsistent ? "component-inconsistent" : "component-exact",
    componentFields,
    hasInputOutput,
    hasAggregate,
    aggregateConsistent,
  };
};

const cumulativeFingerprintOf = (event: CodexAccountingEvent): string | undefined => {
  const total = event.tokenCount?.total;
  return total ? JSON.stringify(total) : undefined;
};

const sameTimestampOf = (left: CodexAccountingEvent, right: CodexAccountingEvent): boolean =>
  left.timestamp !== undefined && right.timestamp !== undefined && left.timestamp === right.timestamp;

const sameCumulativeSnapshotOf = (left: CodexAccountingEvent, right: CodexAccountingEvent): boolean => {
  const leftTotal = left.tokenCount?.total;
  const rightTotal = right.tokenCount?.total;
  return sameTimestampOf(left, right) && !!leftTotal && !!rightTotal && rawTokenUsageExactEqual(leftTotal, rightTotal);
};

const sameSemanticContentOf = (left: CodexAccountingEvent, right: CodexAccountingEvent): boolean =>
  !!left.semanticContentFingerprint && left.semanticContentFingerprint === right.semanticContentFingerprint;

const sameRawUsageOf = (left: CodexAccountingEvent, right: CodexAccountingEvent): boolean =>
  rawTokenUsageExactEqual(left.tokenCount?.last, right.tokenCount?.last) &&
  rawTokenUsageExactEqual(left.tokenCount?.total, right.tokenCount?.total);

const exactRawDuplicateOf = (left: CodexAccountingEvent, right: CodexAccountingEvent): boolean =>
  sessionOf(left) === sessionOf(right) &&
  left.rawIdentity !== right.rawIdentity &&
  !!rawFingerprintOf(left) &&
  rawFingerprintOf(left) === rawFingerprintOf(right) &&
  sameTimestampOf(left, right) &&
  sameRawUsageOf(left, right) &&
  optionalIdentityCompatible(left.model, right.model);

const candidatePairKey = (left: CodexAccountingEvent, right: CodexAccountingEvent): string =>
  [eventIdentity(left), eventIdentity(right)].sort().join("\n---\n");

interface TransitionEvidence {
  previousCumulative?: RawTokenUsage;
  currentCumulative?: RawTokenUsage;
  transitionUsage?: TokenUsage;
  transitionTokens?: number;
  transitionClassification: TokenCountTransitionClassification;
}

const emptyTransition = (): TransitionEvidence => ({ transitionClassification: "insufficient" });

const usageEqual = (left: TokenUsage | undefined, right: TokenUsage | undefined): boolean =>
  !!left && !!right && left.inputTokens === right.inputTokens &&
  left.cachedInputTokens === right.cachedInputTokens &&
  left.cacheCreationInputTokens === right.cacheCreationInputTokens &&
  left.outputTokens === right.outputTokens &&
  left.reasoningOutputTokens === right.reasoningOutputTokens;

const transitionUsageOf = (current: RawTokenUsage, previous: RawTokenUsage): TokenUsage | undefined => {
  const state: TokenCountState = {
    previousTotalRaw: previous,
    previousAggregateTotal: effectiveAggregateTotal(previous),
    segment: 0,
  };
  const comparison = compareRawCumulative(current, state);
  if (comparison.relation !== "increased") return undefined;
  if (comparison.componentBreakdownExact && comparison.rawDelta)
    return normalizeRawTokenUsage(comparison.rawDelta);
  if (comparison.aggregateDelta !== undefined)
    return usageOf({
      input: comparison.aggregateDelta,
      cachedInput: 0,
      cacheCreationInput: 0,
      output: 0,
      reasoningOutput: 0,
      total: comparison.aggregateDelta,
      fieldPresence: { input: true, cachedInput: false, cacheCreationInput: false, output: false, reasoningOutput: false, total: true },
    });
  return undefined;
};

const buildTransitionIndex = (ordered: readonly CodexAccountingEvent[]): Map<string, TransitionEvidence> => {
  const result = new Map<string, TransitionEvidence>();
  const lastDistinctBySession = new Map<string, { fingerprint: string; raw: RawTokenUsage }>();
  const lastTransitionBySession = new Map<string, { fingerprint: string; transition: TransitionEvidence }>();
  for (const event of ordered) {
    const current = event.tokenCount?.total;
    if (!current) {
      result.set(eventIdentity(event), emptyTransition());
      continue;
    }
    const session = sessionOf(event);
    const fingerprint = cumulativeFingerprintOf(event);
    const previousTransition = lastTransitionBySession.get(session);
    if (fingerprint && previousTransition?.fingerprint === fingerprint) {
      result.set(eventIdentity(event), previousTransition.transition);
      continue;
    }
    const previous = lastDistinctBySession.get(session);
    const transition: TransitionEvidence = {
      previousCumulative: previous?.raw,
      currentCumulative: current,
      transitionClassification: "insufficient",
    };
    if (previous) {
      const comparison = compareRawCumulative(current, {
        previousTotalRaw: previous.raw,
        previousAggregateTotal: effectiveAggregateTotal(previous.raw),
        segment: 0,
      });
      if (comparison.relation === "reset") transition.transitionClassification = "reset";
      else if (comparison.relation === "incomparable" || comparison.relation === "same") transition.transitionClassification = "incomparable";
      else if (comparison.relation === "increased") {
        transition.transitionUsage = transitionUsageOf(current, previous.raw);
        if (transition.transitionUsage) {
          transition.transitionTokens = totalTokens(transition.transitionUsage);
          transition.transitionClassification = "neither";
        } else {
          transition.transitionClassification = "incomparable";
        }
      }
    }
    result.set(eventIdentity(event), transition);
    if (fingerprint) {
      lastTransitionBySession.set(session, { fingerprint, transition });
      lastDistinctBySession.set(session, { fingerprint, raw: current });
    }
  }
  return result;
};

const classify = (
  primary: CodexAccountingEvent,
  candidate: CodexAccountingEvent,
  transitions: ReadonlyMap<string, TransitionEvidence>,
): TokenCountDuplicateEvidenceV5 => {
  const sameTimestamp = sameTimestampOf(primary, candidate);
  const sameRawContent = !!rawFingerprintOf(primary) && rawFingerprintOf(primary) === rawFingerprintOf(candidate);
  const sameSemanticContent = sameSemanticContentOf(primary, candidate);
  const sameCumulativeSnapshot = sameCumulativeSnapshotOf(primary, candidate);
  const responseIdCompatible = optionalIdentityCompatible(primary.responseId, candidate.responseId);
  const turnIdCompatible = optionalIdentityCompatible(primary.turnId, candidate.turnId);
  const modelCompatible = optionalIdentityCompatible(primary.model, candidate.model);
  const explicitConflict = !responseIdCompatible || !turnIdCompatible || !modelCompatible;
  const primaryPrecision = usagePrecisionOf(primary);
  const candidatePrecision = usagePrecisionOf(candidate);
  const representationPair = sameCumulativeSnapshot && primaryPrecision.kind !== candidatePrecision.kind;
  const primaryTransition = transitions.get(eventIdentity(primary)) ?? emptyTransition();
  const candidateTransition = transitions.get(eventIdentity(candidate)) ?? emptyTransition();
  const primaryMatchesTransition = usageEqual(usageOf(usageRawOf(primary)), primaryTransition.transitionUsage);
  const candidateMatchesTransition = usageEqual(usageOf(usageRawOf(candidate)), candidateTransition.transitionUsage);
  let transitionClassification: TokenCountTransitionClassification = "insufficient";
  if (primaryTransition.transitionClassification === "reset" || candidateTransition.transitionClassification === "reset")
    transitionClassification = "reset";
  else if (primaryTransition.transitionClassification === "incomparable" || candidateTransition.transitionClassification === "incomparable")
    transitionClassification = "incomparable";
  else if (primaryTransition.transitionUsage && candidateTransition.transitionUsage) {
    if (primaryMatchesTransition && candidateMatchesTransition) transitionClassification = "both";
    else if (primaryMatchesTransition) transitionClassification = "primary-only";
    else if (candidateMatchesTransition) transitionClassification = "candidate-only";
    else transitionClassification = "neither";
  }
  const semanticDiffPaths = sameSemanticContent && !sameRawContent ? ["payload.rate_limits"] : [];
  let kind: TokenCountDuplicateEvidenceKind;
  let confidence: TokenCountDuplicateConfidence;
  let reason: string;
  if (explicitConflict) {
    kind = "explicit-conflict";
    confidence = "conflict";
    reason = "an explicit response, turn, or model identity conflicts";
  } else if (sameRawContent) {
    kind = "exact-raw-content";
    confidence = "confirmed";
    reason = "the complete raw TokenCount content is identical";
  } else if (sameCumulativeSnapshot) {
    kind = representationPair ? "representation-pair" : sameSemanticContent ? "same-semantic-content" : "same-cumulative-snapshot";
    const sharedIdentity = positivelyMatched(primary.responseId, candidate.responseId) || positivelyMatched(primary.turnId, candidate.turnId);
    const transitionResolved = transitionClassification === "primary-only" || transitionClassification === "candidate-only" || transitionClassification === "both";
    confidence = sharedIdentity || transitionResolved ? "strong" : "probable";
    reason = representationPair
      ? "the timestamp and cumulative snapshot match but usage representations differ"
      : sameSemanticContent
        ? semanticDiffPaths.length > 0 ? "the semantic content matches; only the whitelisted rate-limit payload differs" : "the timestamp, cumulative snapshot, and semantic content match"
        : confidence === "strong"
          ? transitionResolved ? `the timestamp and cumulative snapshot match; transition classification is ${transitionClassification}` : "the timestamp and cumulative snapshot match with a shared explicit identity"
          : "the timestamp and cumulative snapshot match without a shared explicit identity";
  } else {
    kind = "insufficient";
    confidence = "insufficient";
    reason = "the candidate lacks the exact timestamp and cumulative evidence required for classification";
  }
  return {
    sessionId: sessionOf(primary),
    primaryRawIdentity: primary.rawIdentity,
    candidateRawIdentity: candidate.rawIdentity,
    primaryEventIndex: primary.eventIndex,
    candidateEventIndex: candidate.eventIndex,
    kind,
    sameTimestamp,
    sameRawContent,
    sameSemanticContent,
    sameCumulativeSnapshot,
    responseIdCompatible,
    turnIdCompatible,
    modelCompatible,
    primaryUsage: usageOf(usageRawOf(primary)),
    candidateUsage: usageOf(usageRawOf(candidate)),
    primaryTokens: tokensOf(primary),
    candidateTokens: tokensOf(candidate),
    confidence,
    suppressible: false,
    reason,
    previousCumulative: primaryTransition.previousCumulative ?? candidateTransition.previousCumulative,
    currentCumulative: primaryTransition.currentCumulative ?? candidateTransition.currentCumulative,
    transitionUsage: primaryTransition.transitionUsage ?? candidateTransition.transitionUsage,
    transitionTokens: primaryTransition.transitionTokens ?? candidateTransition.transitionTokens,
    primaryMatchesTransition,
    candidateMatchesTransition,
    transitionClassification,
    semanticDiffPaths,
  };
};

export function summarizeTokenCountDuplicateEvidence(
  evidence: readonly TokenCountDuplicateEvidenceV5[],
  detailLimit = 20,
): CodexTokenCountDuplicateEvidenceSummary {
  const result = emptySummary();
  result.candidatePairs = evidence.length;
  result.confirmedPairs = evidence.filter((item) => item.confidence === "confirmed").length;
  result.strongPairs = evidence.filter((item) => item.confidence === "strong").length;
  result.probablePairs = evidence.filter((item) => item.confidence === "probable").length;
  result.conflictPairs = evidence.filter((item) => item.confidence === "conflict").length;
  result.insufficientPairs = evidence.filter((item) => item.confidence === "insufficient").length;
  result.confirmedCandidateTokens = evidence.filter((item) => item.confidence === "confirmed").reduce((sum, item) => sum + item.candidateTokens, 0);
  result.strongCandidateTokens = evidence.filter((item) => item.confidence === "strong").reduce((sum, item) => sum + item.candidateTokens, 0);
  result.probableCandidateTokens = evidence.filter((item) => item.confidence === "probable").reduce((sum, item) => sum + item.candidateTokens, 0);
  result.unresolvedCandidateTokens = evidence.filter((item) => item.confidence !== "confirmed").reduce((sum, item) => sum + item.candidateTokens, 0);
  for (const item of evidence) {
    if (item.transitionClassification === "primary-only") result.transition.primaryOnly += 1;
    else if (item.transitionClassification === "candidate-only") result.transition.candidateOnly += 1;
    else if (item.transitionClassification === "both") result.transition.both += 1;
    else if (item.transitionClassification === "neither") result.transition.neither += 1;
    else if (item.transitionClassification === "reset") result.transition.reset += 1;
    else if (item.transitionClassification === "incomparable") result.transition.incomparable += 1;
    else result.transition.insufficient += 1;
    if (item.confidence === "confirmed") result.confirmedSuppressionTokens += item.candidateTokens;
    if (item.confidence === "strong") result.strongSuppressionCandidateTokens += item.candidateTokens;
    if (item.confidence === "probable") {
      result.probablePrimaryTokens += item.primaryTokens;
      result.probableCandidateTokens += item.candidateTokens;
    }
    if (item.confidence === "strong" && item.transitionClassification === "candidate-only")
      result.representativeChoiceDelta += item.candidateTokens - item.primaryTokens;
  }
  result.examples = evidence.slice(0, Math.max(0, detailLimit));
  return result;
}

/** Evidence-only analysis. It never changes or suppresses the input events. */
export function analyzeTokenCountDuplicatesV5(
  events: readonly CodexAccountingEvent[],
  options: TokenCountDuplicateEvidenceOptions = {},
): CodexTokenCountDuplicateEvidenceSummary {
  const ordered = [...events].filter((event) => !!event.tokenCount).sort(eventOrder);
  const exactIndex = new Map<string, CodexAccountingEvent>();
  const cumulativeIndex = new Map<string, CodexAccountingEvent>();
  const pairs = new Map<string, [CodexAccountingEvent, CodexAccountingEvent]>();
  const transitions = buildTransitionIndex(ordered);
  const addPair = (left: CodexAccountingEvent | undefined, right: CodexAccountingEvent | undefined): void => {
    if (!left || !right || eventIdentity(left) === eventIdentity(right)) return;
    const pair = [left, right].sort(eventOrder) as [CodexAccountingEvent, CodexAccountingEvent];
    pairs.set(candidatePairKey(pair[0], pair[1]), pair);
  };
  for (const event of ordered) {
    const session = sessionOf(event);
    const rawFingerprint = rawFingerprintOf(event);
    if (rawFingerprint) {
      const key = `${session}\n${rawFingerprint}`;
      addPair(exactIndex.get(key), event);
      if (!exactIndex.has(key)) exactIndex.set(key, event);
    }
    const cumulativeFingerprint = cumulativeFingerprintOf(event);
    if (event.timestamp !== undefined && cumulativeFingerprint) {
      const key = `${session}\n${event.timestamp}\n${cumulativeFingerprint}`;
      addPair(cumulativeIndex.get(key), event);
      if (!cumulativeIndex.has(key)) cumulativeIndex.set(key, event);
    }
  }
  const evidence = [...pairs.values()].map(([primary, candidate]) => classify(primary, candidate, transitions))
    .sort((left, right) => right.candidateTokens - left.candidateTokens || left.primaryEventIndex - right.primaryEventIndex || left.candidateEventIndex - right.candidateEventIndex);
  return summarizeTokenCountDuplicateEvidence(evidence, options.detailLimit ?? 20);
}

/** Suppresses only confirmed complete-Raw duplicates, before accounting state advances. */
export function resolveTokenCountDuplicatesV5(
  events: readonly CodexAccountingEvent[],
  options: TokenCountDuplicateEvidenceOptions = {},
): TokenCountDuplicateResolutionV5 {
  const ordered = [...events].filter((event) => !!event.tokenCount).sort(eventOrder);
  const analysis = analyzeTokenCountDuplicatesV5(ordered, options);
  const groups = new Map<string, CodexAccountingEvent[]>();
  for (const event of ordered) {
    const fingerprint = rawFingerprintOf(event);
    if (!fingerprint) continue;
    const key = `${sessionOf(event)}\n${fingerprint}`;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const suppressed: TokenCountSuppressionV5[] = [];
  const suppressedIds = new Set<string>();
  let duplicateConflicts = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const orderedGroup = [...group].sort(eventOrder);
    const representative = orderedGroup[0]!;
    for (const candidate of orderedGroup.slice(1)) {
      if (!exactRawDuplicateOf(representative, candidate)) {
        duplicateConflicts += 1;
        continue;
      }
      suppressedIds.add(eventIdentity(candidate));
      suppressed.push({
        sessionId: sessionOf(candidate),
        representativeRawIdentity: representative.rawIdentity,
        suppressedRawIdentity: candidate.rawIdentity,
        kind: "exact-raw-content",
        confidence: "confirmed",
        suppressedUsage: usageOf(usageRawOf(candidate)),
        suppressedTokens: tokensOf(candidate),
      });
    }
  }
  const fullEvidence = options.detailLimit === undefined || analysis.examples.length >= analysis.candidatePairs
    ? analysis.examples
    : analyzeTokenCountDuplicatesV5(ordered, { detailLimit: Number.MAX_SAFE_INTEGER }).examples;
  const diagnostics: TokenCountDuplicateDiagnosticsV5 = {
    exactRawContentDuplicateEvents: suppressed.length,
    semanticDuplicateCandidates: fullEvidence.filter((item) => item.confidence !== "confirmed").length,
    suppressedDuplicateEvents: suppressed.length,
    suppressedDuplicateTokens: suppressed.reduce((sum, item) => sum + item.suppressedTokens, 0),
    duplicateConflicts,
  };
  return {
    events: ordered.filter((event) => !suppressedIds.has(eventIdentity(event))),
    evidence: fullEvidence,
    suppressed,
    diagnostics,
    summary: summarizeTokenCountDuplicateEvidence(fullEvidence, options.detailLimit ?? 20),
    safe: duplicateConflicts === 0,
  };
}
