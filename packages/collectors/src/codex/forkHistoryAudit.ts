import { totalTokens, type TokenUsage } from "@lw-aiusage/core";
import { stableHash } from "../shared/identity";
import type { ParserV4MirrorRecord, V4ForkTrace } from "./rawAuditTypes";

export type CodexForkOutcome =
  | "full-replay-only"
  | "persisted-only"
  | "both-same"
  | "both-different"
  | "neither"
  | "unresolved";

export interface CodexForkHistoryAuditItem {
  childSessionHash: string;
  parentSessionHash?: string;
  persistedBaseline?: TokenUsage;
  fullReplayBaseline?: TokenUsage;
  baselineDifference?: TokenUsage;
  baselineDifferenceTokens: number;
  baselineDifferenceNetTokens: number;
  baselineDifferenceMagnitudeTokens: number;
  childFirstTotal?: TokenUsage;
  childFirstLast?: TokenUsage;
  persistedContribution?: TokenUsage;
  fullReplayContribution?: TokenUsage;
  contributionDifferenceTokens: number;
  contributionMatched: boolean;
  outcome: CodexForkOutcome;
  mirrorOnlyRecordHash?: string;
  mirrorOnlyRecordHashes: string[];
  baselineMatched: boolean;
  explainsMirrorOnly: boolean;
}

export interface CodexForkHistoryAudit {
  forkSessions: number;
  persistedBaselineAvailable: number;
  fullReplayBaselineAvailable: number;
  baselineMatched: number;
  baselineDifferent: number;
  explainedMirrorOnlyRecords: number;
  unexplainedMirrorOnlyRecords: number;
  explainedTokens: number;
  forkMirrorOnlyInvariant: boolean;
  globalMirrorOnlyExplainedPercent: number;
  items: CodexForkHistoryAuditItem[];
}

interface ForkCursorLike {
  parserState?: {
    sessionId?: string;
    forkedFromSessionId?: string;
    forkBaselineUsage?: TokenUsage;
  };
}

interface RecordSetDiffLike {
  mirrorOnlyIds: ReadonlySet<string>;
  databaseOnlyIds: ReadonlySet<string>;
  contentMismatchIds: ReadonlySet<string>;
}

const cloneUsage = (value: TokenUsage): TokenUsage => ({ ...value });
const hasTokens = (value: TokenUsage | undefined): value is TokenUsage =>
  !!value && totalTokens(value) > 0;
const sameUsageExact = (left: TokenUsage, right: TokenUsage): boolean =>
  left.inputTokens === right.inputTokens &&
  left.cachedInputTokens === right.cachedInputTokens &&
  left.cacheCreationInputTokens === right.cacheCreationInputTokens &&
  left.outputTokens === right.outputTokens &&
  left.reasoningOutputTokens === right.reasoningOutputTokens;
const subtractPositive = (left: TokenUsage, right: TokenUsage): TokenUsage => ({
  inputTokens: Math.max(left.inputTokens - right.inputTokens, 0),
  cachedInputTokens: Math.max(left.cachedInputTokens - right.cachedInputTokens, 0),
  cacheCreationInputTokens: Math.max(left.cacheCreationInputTokens - right.cacheCreationInputTokens, 0),
  outputTokens: Math.max(left.outputTokens - right.outputTokens, 0),
  reasoningOutputTokens: Math.max(left.reasoningOutputTokens - right.reasoningOutputTokens, 0),
});
const subtractSigned = (left: TokenUsage, right: TokenUsage): TokenUsage => ({
  inputTokens: left.inputTokens - right.inputTokens,
  cachedInputTokens: left.cachedInputTokens - right.cachedInputTokens,
  cacheCreationInputTokens: left.cacheCreationInputTokens - right.cacheCreationInputTokens,
  outputTokens: left.outputTokens - right.outputTokens,
  reasoningOutputTokens: left.reasoningOutputTokens - right.reasoningOutputTokens,
});
const usageDifferenceMagnitude = (value: TokenUsage): number =>
  Math.abs(value.inputTokens) +
  Math.abs(value.cachedInputTokens) +
  Math.abs(value.cacheCreationInputTokens) +
  Math.abs(value.outputTokens) +
  Math.abs(value.reasoningOutputTokens);

function outcomeOf(
  firstReplayRecord: ParserV4MirrorRecord | undefined,
  persistedContribution: TokenUsage | undefined,
  fullReplayContribution: TokenUsage | undefined,
  contentMismatchIds: ReadonlySet<string>,
): CodexForkOutcome {
  if (!firstReplayRecord || (!persistedContribution && !fullReplayContribution))
    return "unresolved";
  const persistedEmitsRecord = hasTokens(persistedContribution);
  const fullReplayEmitsRecord = hasTokens(fullReplayContribution);
  if (fullReplayEmitsRecord && !persistedEmitsRecord && contentMismatchIds.has(firstReplayRecord.id))
    return "both-different";
  if (fullReplayEmitsRecord && !persistedEmitsRecord) return "full-replay-only";
  if (!fullReplayEmitsRecord && persistedEmitsRecord) return "persisted-only";
  if (persistedEmitsRecord && fullReplayEmitsRecord)
    return sameUsageExact(persistedContribution!, fullReplayContribution!)
      ? "both-same"
      : "both-different";
  return "neither";
}

export function auditCodexForkHistory(
  traces: readonly V4ForkTrace[],
  cursors: readonly ForkCursorLike[],
  mirrorRecords: readonly ParserV4MirrorRecord[],
  recordDiff: RecordSetDiffLike,
): CodexForkHistoryAudit {
  const persisted = new Map<string, { parent?: string; baseline?: TokenUsage }>();
  for (const cursor of cursors) {
    const state = cursor.parserState;
    if (state?.sessionId && state.forkedFromSessionId)
      persisted.set(state.sessionId, { parent: state.forkedFromSessionId, baseline: state.forkBaselineUsage });
  }
  const traceByChild = new Map(traces.map((trace) => [trace.childSessionId, trace]));
  const childIds = new Set([...persisted.keys(), ...traces.map((trace) => trace.childSessionId)]);
  const forkMirrorOnlyIds = new Set(
    mirrorRecords
      .filter((record) => !!record.sessionId && childIds.has(record.sessionId) && recordDiff.mirrorOnlyIds.has(record.id))
      .map((record) => record.id),
  );
  const items: CodexForkHistoryAuditItem[] = [];
  let persistedBaselineAvailable = 0;
  let fullReplayBaselineAvailable = 0;
  let baselineMatched = 0;
  let baselineDifferent = 0;
  let explainedMirrorOnlyRecords = 0;
  let explainedTokens = 0;
  const explainedMirrorOnlyIds = new Set<string>();
  for (const childSessionId of childIds) {
    const persistedItem = persisted.get(childSessionId);
    const trace = traceByChild.get(childSessionId);
    const persistedBaseline = persistedItem?.baseline;
    const fullReplayBaseline = trace?.baselineUsed;
    if (persistedBaseline) persistedBaselineAvailable += 1;
    if (fullReplayBaseline) fullReplayBaselineAvailable += 1;
    const baselineDifference = persistedBaseline && fullReplayBaseline
      ? subtractSigned(fullReplayBaseline, persistedBaseline)
      : undefined;
    const baselineDifferenceNetTokens = baselineDifference ? totalTokens(baselineDifference) : 0;
    const baselineDifferenceMagnitudeTokens = baselineDifference
      ? usageDifferenceMagnitude(baselineDifference)
      : 0;
    const baselineMatchedValue = !!persistedBaseline && !!fullReplayBaseline && sameUsageExact(persistedBaseline, fullReplayBaseline);
    if (baselineMatchedValue) baselineMatched += 1;
    else if (persistedBaseline && fullReplayBaseline) baselineDifferent += 1;
    const firstReplayRecord = trace?.firstUsageEventId
      ? mirrorRecords.find((record) => record.id === trace.firstUsageEventId)
      : undefined;
    const childFirstTotal = trace?.firstTotal;
    const persistedContribution = childFirstTotal && persistedBaseline
      ? subtractPositive(childFirstTotal, persistedBaseline)
      : undefined;
    const fullReplayContribution = trace?.firstContribution;
    const contributionMatched = !!persistedContribution && !!fullReplayContribution && sameUsageExact(persistedContribution, fullReplayContribution);
    const isMirrorOnly = !!firstReplayRecord && recordDiff.mirrorOnlyIds.has(firstReplayRecord.id);
    const fullReplayEmitsRecord = hasTokens(fullReplayContribution);
    const persistedEmitsRecord = hasTokens(persistedContribution);
    const explainsMirrorOnly = isMirrorOnly &&
      fullReplayEmitsRecord &&
      !persistedEmitsRecord &&
      !!trace?.firstContribution &&
      !!firstReplayRecord &&
      sameUsageExact(firstReplayRecord.usage, trace.firstContribution);
    if (explainsMirrorOnly && firstReplayRecord) {
      explainedMirrorOnlyRecords += 1;
      explainedTokens += totalTokens(firstReplayRecord.usage);
      explainedMirrorOnlyIds.add(firstReplayRecord.id);
    }
    const mirrorOnlyRecordHashes = isMirrorOnly && firstReplayRecord
      ? [stableHash(firstReplayRecord.id)]
      : [];
    items.push({
      childSessionHash: stableHash(childSessionId),
      parentSessionHash: (persistedItem?.parent ?? trace?.parentSessionId)
        ? stableHash(persistedItem?.parent ?? trace!.parentSessionId)
        : undefined,
      persistedBaseline: persistedBaseline ? cloneUsage(persistedBaseline) : undefined,
      fullReplayBaseline: fullReplayBaseline ? cloneUsage(fullReplayBaseline) : undefined,
      baselineDifference: baselineDifference ? cloneUsage(baselineDifference) : undefined,
      baselineDifferenceTokens: baselineDifferenceNetTokens,
      baselineDifferenceNetTokens,
      baselineDifferenceMagnitudeTokens,
      childFirstTotal: childFirstTotal ? cloneUsage(childFirstTotal) : undefined,
      childFirstLast: trace?.firstLast ? cloneUsage(trace.firstLast) : undefined,
      persistedContribution: persistedContribution ? cloneUsage(persistedContribution) : undefined,
      fullReplayContribution: fullReplayContribution ? cloneUsage(fullReplayContribution) : undefined,
      contributionDifferenceTokens: persistedContribution && fullReplayContribution
        ? totalTokens(subtractSigned(fullReplayContribution, persistedContribution))
        : 0,
      contributionMatched,
      outcome: outcomeOf(firstReplayRecord, persistedContribution, fullReplayContribution, recordDiff.contentMismatchIds),
      mirrorOnlyRecordHash: mirrorOnlyRecordHashes[0],
      mirrorOnlyRecordHashes,
      baselineMatched: baselineMatchedValue,
      explainsMirrorOnly,
    });
  }
  const forkMirrorOnlyRecordCount = forkMirrorOnlyIds.size;
  const unexplainedMirrorOnlyRecords = [...forkMirrorOnlyIds].filter((id) => !explainedMirrorOnlyIds.has(id)).length;
  return {
    forkSessions: childIds.size,
    persistedBaselineAvailable,
    fullReplayBaselineAvailable,
    baselineMatched,
    baselineDifferent,
    explainedMirrorOnlyRecords,
    unexplainedMirrorOnlyRecords,
    explainedTokens,
    forkMirrorOnlyInvariant: explainedMirrorOnlyRecords + unexplainedMirrorOnlyRecords === forkMirrorOnlyRecordCount,
    globalMirrorOnlyExplainedPercent: forkMirrorOnlyRecordCount
      ? (explainedMirrorOnlyRecords / forkMirrorOnlyRecordCount) * 100
      : 100,
    items,
  };
}
