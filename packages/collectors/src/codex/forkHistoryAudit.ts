import { totalTokens, type TokenUsage } from "@lw-aiusage/core";
import { stableHash } from "../shared/identity";
import type { ParserV4MirrorRecord, V4ForkTrace } from "./rawAuditTypes";

export interface CodexForkHistoryAuditItem {
  childSessionHash: string;
  parentSessionHash?: string;
  persistedBaseline?: TokenUsage;
  fullReplayBaseline?: TokenUsage;
  baselineDifference?: TokenUsage;
  baselineDifferenceTokens: number;
  childFirstTotal?: TokenUsage;
  childFirstLast?: TokenUsage;
  persistedContribution?: TokenUsage;
  fullReplayContribution?: TokenUsage;
  contributionDifferenceTokens: number;
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
  items: CodexForkHistoryAuditItem[];
}

interface ForkCursorLike {
  parserState?: {
    sessionId?: string;
    forkedFromSessionId?: string;
    forkBaselineUsage?: TokenUsage;
  };
}

const cloneUsage = (value: TokenUsage): TokenUsage => ({ ...value });
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

export function auditCodexForkHistory(
  traces: readonly V4ForkTrace[],
  cursors: readonly ForkCursorLike[],
  mirrorRecords: readonly ParserV4MirrorRecord[],
  databaseRecordIds: ReadonlySet<string>,
): CodexForkHistoryAudit {
  const persisted = new Map<string, { parent?: string; baseline?: TokenUsage }>();
  for (const cursor of cursors) {
    const state = cursor.parserState;
    if (state?.sessionId && state.forkedFromSessionId)
      persisted.set(state.sessionId, { parent: state.forkedFromSessionId, baseline: state.forkBaselineUsage });
  }
  const traceByChild = new Map(traces.map((trace) => [trace.childSessionId, trace]));
  const childIds = new Set([...persisted.keys(), ...traces.map((trace) => trace.childSessionId)]);
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
    const baselineDifferenceTokens = baselineDifference ? totalTokens(baselineDifference) : 0;
    const baselineMatchedValue = !!persistedBaseline && !!fullReplayBaseline && baselineDifferenceTokens === 0;
    if (baselineMatchedValue) baselineMatched += 1;
    else if (persistedBaseline && fullReplayBaseline) baselineDifferent += 1;
    const mirrorOnly = mirrorRecords.filter((record) => record.sessionId === childSessionId && !databaseRecordIds.has(record.id));
    const mirrorOnlyTokens = mirrorOnly.reduce((sum, record) => sum + totalTokens(record.usage), 0);
    const childFirstTotal = trace?.firstTotal;
    const persistedContribution = childFirstTotal && persistedBaseline
      ? subtractPositive(childFirstTotal, persistedBaseline)
      : undefined;
    const fullReplayContribution = trace?.firstContribution;
    const contributionDifference = persistedContribution && fullReplayContribution
      ? subtractSigned(fullReplayContribution, persistedContribution)
      : undefined;
    const contributionDifferenceTokens = contributionDifference ? totalTokens(contributionDifference) : 0;
    const explainsMirrorOnly = mirrorOnlyTokens > 0 &&
      !!contributionDifference &&
      Math.abs(contributionDifferenceTokens) === mirrorOnlyTokens;
    if (explainsMirrorOnly) {
      explainedMirrorOnlyRecords += mirrorOnly.length;
      explainedTokens += mirrorOnlyTokens;
      for (const record of mirrorOnly) explainedMirrorOnlyIds.add(record.id);
    }
    items.push({
      childSessionHash: stableHash(childSessionId),
      parentSessionHash: (persistedItem?.parent ?? trace?.parentSessionId)
        ? stableHash(persistedItem?.parent ?? trace!.parentSessionId)
        : undefined,
      persistedBaseline: persistedBaseline ? cloneUsage(persistedBaseline) : undefined,
      fullReplayBaseline: fullReplayBaseline ? cloneUsage(fullReplayBaseline) : undefined,
      baselineDifference,
      baselineDifferenceTokens,
      childFirstTotal: childFirstTotal ? cloneUsage(childFirstTotal) : undefined,
      childFirstLast: trace?.firstLast ? cloneUsage(trace.firstLast) : undefined,
      persistedContribution,
      fullReplayContribution: fullReplayContribution ? cloneUsage(fullReplayContribution) : undefined,
      contributionDifferenceTokens,
      mirrorOnlyRecordHashes: mirrorOnly.slice(0, 20).map((record) => stableHash(record.id)),
      baselineMatched: baselineMatchedValue,
      explainsMirrorOnly,
    });
  }
  return {
    forkSessions: childIds.size,
    persistedBaselineAvailable,
    fullReplayBaselineAvailable,
    baselineMatched,
    baselineDifferent,
    explainedMirrorOnlyRecords,
    unexplainedMirrorOnlyRecords: mirrorRecords.filter((record) => record.sessionId && !databaseRecordIds.has(record.id) && !explainedMirrorOnlyIds.has(record.id)).length,
    explainedTokens,
    items,
  };
}
