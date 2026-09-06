import { totalTokens, type TokenUsage } from "@lw-aiusage/core";
import {
  compareRawCumulative,
  deriveTokenCountContribution,
  effectiveAggregateTotal,
  type CodexAccountingEvent,
  type RawTokenUsage,
  type TokenCountAccountingMethod,
  type TokenCountState,
} from "./accountingV5";
import {
  type CanonicalTokenCountRef,
  type PayloadFallbackContribution,
  type UsagePrecision,
} from "./payloadFallbackV5";

export interface ForkSessionSourceV5 {
  /**
   * One already reconciled logical Codex session per sessionId.
   * sessions/ and archived_sessions/ duplicates must be reconciled before
   * entering this layer.
   */
  sessionId: string;
  parentSessionId?: string;
  forkTimestamp?: number;
  events: readonly CodexAccountingEvent[];
}

export interface ForkSessionNodeV5 {
  session: ForkSessionSourceV5;
  parent?: ForkSessionSourceV5;
  children: string[];
}

export interface ForkSessionGraphV5 {
  nodes: Map<string, ForkSessionNodeV5>;
  topologicalOrder: string[];
  cycles: string[][];
  missingParents: string[];
  conflictingParents: string[];
}

export interface ForkBaselineCheckpointV5 {
  parentSessionId: string;
  event: CodexAccountingEvent;
  rawTotal: RawTokenUsage;
  aggregateTotal: number;
  timestamp: number;
}

export type ForkBaselineStatus =
  | "resolved"
  | "not-fork"
  | "explicit-replay"
  | "not-needed"
  | "missing-parent"
  | "missing-fork-timestamp"
  | "missing-parent-checkpoint"
  | "missing-child-total-timestamp"
  | "child-counter-reset"
  | "incomparable"
  | "cycle"
  | "conflicting-parent";

export interface ForkBaselineResolutionV5 {
  sessionId: string;
  parentSessionId?: string;
  status: ForkBaselineStatus;
  checkpoint?: ForkBaselineCheckpointV5;
  initialState?: TokenCountState;
  firstChildTotalEvent?: CodexAccountingEvent;
  previewMethod?: TokenCountAccountingMethod;
  inheritedAggregate?: number;
  previewContributionAggregate?: number;
}

export interface ForkBaselineDiagnosticsV5 {
  forkSessions: number;
  resolvedBaselineSessions: number;
  explicitReplaySessions: number;
  noReplaySessions: number;
  missingParentSessions: number;
  missingForkTimestampSessions: number;
  missingParentCheckpointSessions: number;
  missingChildTotalTimestampSessions: number;
  counterResetAtForkSessions: number;
  incomparableBaselineSessions: number;
  cycleSessions: number;
  replaySuppressedEvents: number;
  replaySuppressedTokens: number;
  partialReplayBlockedEvents: number;
  missingReplayIdentityEvents: number;
  replayPrefixMismatchSessions: number;
  conflictingParentSessions: number;
}

export interface ForkBaselinePlanV5 {
  graph: ForkSessionGraphV5;
  resolutions: Map<string, ForkBaselineResolutionV5>;
  diagnostics: ForkBaselineDiagnosticsV5;
}

export type CanonicalUsageSourceV5 = "token-count" | "payload-fallback";

export interface CanonicalUsageContributionV5 {
  event: CodexAccountingEvent;
  usage: TokenUsage;
  aggregateTotal: number;
  precision: UsagePrecision;
  sourceKind: CanonicalUsageSourceV5;
}

export interface ForkCanonicalSessionV5 {
  sessionId: string;
  parentSessionId?: string;
  forkTimestamp?: number;
  contributions: readonly CanonicalUsageContributionV5[];
}

export interface ForkReplaySuppressionV5 {
  child: CanonicalUsageContributionV5;
  parent: CanonicalUsageContributionV5;
  childIndex: number;
  parentIndex: number;
  suppressedTokens: number;
}

export type ForkReplaySessionStatus =
  | "not-fork"
  | "resolved"
  | "missing-parent"
  | "missing-fork-timestamp"
  | "cycle"
  | "conflicting-parent";

export interface ForkReplaySessionResultV5 {
  sessionId: string;
  parentSessionId?: string;
  status: ForkReplaySessionStatus;
  suppressed: ForkReplaySuppressionV5[];
  kept: CanonicalUsageContributionV5[];
  replayPrefixCount: number;
  replayPrefixTokens: number;
}

export interface ForkReplayResultV5 {
  sessions: ForkReplaySessionResultV5[];
  diagnostics: ForkReplayDiagnosticsV5;
  contributionInvariant: boolean;
  tokenInvariant: boolean;
}

export interface ForkReplayDiagnosticsV5 extends ForkBaselineDiagnosticsV5 {}

const compareEvent = (left: CodexAccountingEvent, right: CodexAccountingEvent): number => {
  const leftTimestamp = left.timestamp ?? Number.MAX_SAFE_INTEGER;
  const rightTimestamp = right.timestamp ?? Number.MAX_SAFE_INTEGER;
  return leftTimestamp - rightTimestamp ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.eventIndex - right.eventIndex ||
    left.rawIdentity.localeCompare(right.rawIdentity);
};

const compareSession = (left: ForkSessionSourceV5, right: ForkSessionSourceV5): number =>
  left.sessionId.localeCompare(right.sessionId) ||
  (left.parentSessionId ?? "").localeCompare(right.parentSessionId ?? "") ||
  (left.forkTimestamp ?? Number.MAX_SAFE_INTEGER) - (right.forkTimestamp ?? Number.MAX_SAFE_INTEGER);

const orderedEvents = (events: readonly CodexAccountingEvent[]): CodexAccountingEvent[] =>
  [...events].sort(compareEvent);

const orderedSessions = (sessions: readonly ForkSessionSourceV5[]): ForkSessionSourceV5[] =>
  [...sessions].sort(compareSession);

const compareContribution = (
  left: CanonicalUsageContributionV5,
  right: CanonicalUsageContributionV5,
): number => compareEvent(left.event, right.event);

const orderedContributions = (
  contributions: readonly CanonicalUsageContributionV5[],
): CanonicalUsageContributionV5[] => [...contributions].sort(compareContribution);

const sameUsageComponents = (left: TokenUsage, right: TokenUsage): boolean =>
  left.inputTokens === right.inputTokens &&
  left.cachedInputTokens === right.cachedInputTokens &&
  left.cacheCreationInputTokens === right.cacheCreationInputTokens &&
  left.outputTokens === right.outputTokens &&
  left.reasoningOutputTokens === right.reasoningOutputTokens;

const hasUsageEvent = (event: CodexAccountingEvent): boolean =>
  !!event.tokenCount || !!event.payloadUsage;

const hasReplayIdentity = (event: CodexAccountingEvent): boolean =>
  !!event.responseId || !!event.turnId;

export interface ForkReplayIdentityComparison {
  compatible: boolean;
  hasSharedIdentity: boolean;
  responseMatch: boolean;
  turnMatch: boolean;
  responseConflict: boolean;
  turnConflict: boolean;
}

export function compareForkReplayIdentity(
  parent: CodexAccountingEvent,
  child: CodexAccountingEvent,
): ForkReplayIdentityComparison {
  const parentResponse = parent.responseId;
  const childResponse = child.responseId;
  const parentTurn = parent.turnId;
  const childTurn = child.turnId;
  const responseConflict = !!parentResponse && !!childResponse && parentResponse !== childResponse;
  const turnConflict = !!parentTurn && !!childTurn && parentTurn !== childTurn;
  const responseMatch = !!parentResponse && !!childResponse && parentResponse === childResponse;
  const turnMatch = !!parentTurn && !!childTurn && parentTurn === childTurn;
  return {
    compatible: !responseConflict && !turnConflict && (responseMatch || turnMatch),
    hasSharedIdentity: responseMatch || turnMatch,
    responseMatch,
    turnMatch,
    responseConflict,
    turnConflict,
  };
}

const cycleKey = (cycle: readonly string[]): string => [...cycle].sort().join("\n");

const canonicalCycle = (cycle: readonly string[]): string[] => {
  if (!cycle.length) return [];
  let best = [...cycle];
  for (let index = 1; index < cycle.length; index += 1) {
    const rotated = [...cycle.slice(index), ...cycle.slice(0, index)];
    if (rotated.join("\n") < best.join("\n")) best = rotated;
  }
  return best;
};

export function buildForkSessionGraphV5(
  sessions: readonly ForkSessionSourceV5[],
): ForkSessionGraphV5 {
  const ordered = orderedSessions(sessions);
  const sessionById = new Map<string, ForkSessionSourceV5>();
  const parentIds = new Map<string, Set<string>>();
  for (const session of ordered) {
    if (!sessionById.has(session.sessionId)) sessionById.set(session.sessionId, session);
    const parents = parentIds.get(session.sessionId) ?? new Set<string>();
    if (session.parentSessionId) parents.add(session.parentSessionId);
    parentIds.set(session.sessionId, parents);
  }

  const conflictingParents = [...parentIds.entries()]
    .filter(([, parents]) => parents.size > 1)
    .map(([sessionId]) => sessionId)
    .sort();
  const conflictingSet = new Set(conflictingParents);
  const nodes = new Map<string, ForkSessionNodeV5>();
  for (const session of [...sessionById.values()].sort(compareSession)) {
    const parent = session.parentSessionId && !conflictingSet.has(session.sessionId)
      ? sessionById.get(session.parentSessionId)
      : undefined;
    nodes.set(session.sessionId, { session, parent, children: [] });
  }

  const missingParents = new Set<string>();
  for (const node of nodes.values()) {
    if (!node.session.parentSessionId || conflictingSet.has(node.session.sessionId)) continue;
    if (!node.parent) {
      missingParents.add(node.session.parentSessionId);
      continue;
    }
    nodes.get(node.parent.sessionId)?.children.push(node.session.sessionId);
  }
  for (const node of nodes.values()) node.children.sort();

  const parentOf = new Map<string, string>();
  for (const node of nodes.values()) if (node.parent) parentOf.set(node.session.sessionId, node.parent.sessionId);
  const cycles = new Map<string, string[]>();
  for (const sessionId of nodes.keys()) {
    const path: string[] = [];
    const pathIndexes = new Map<string, number>();
    let current: string | undefined = sessionId;
    while (current && parentOf.has(current)) {
      const previousIndex = pathIndexes.get(current);
      if (previousIndex !== undefined) {
        const cycle = canonicalCycle(path.slice(previousIndex));
        cycles.set(cycleKey(cycle), cycle);
        break;
      }
      pathIndexes.set(current, path.length);
      path.push(current);
      current = parentOf.get(current);
    }
  }

  const indegree = new Map<string, number>();
  for (const sessionId of nodes.keys()) indegree.set(sessionId, 0);
  for (const node of nodes.values()) {
    if (node.parent)
      indegree.set(node.session.sessionId, (indegree.get(node.session.sessionId) ?? 0) + 1);
  }
  const ready = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([sessionId]) => sessionId).sort();
  const topologicalOrder: string[] = [];
  while (ready.length) {
    const sessionId = ready.shift()!;
    topologicalOrder.push(sessionId);
    for (const child of nodes.get(sessionId)?.children ?? []) {
      const nextDegree = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, nextDegree);
      if (nextDegree === 0) {
        ready.push(child);
        ready.sort();
      }
    }
  }
  for (const sessionId of nodes.keys()) if (!topologicalOrder.includes(sessionId)) topologicalOrder.push(sessionId);

  return {
    nodes,
    topologicalOrder,
    cycles: [...cycles.values()].sort((left, right) => left.join("\n").localeCompare(right.join("\n"))),
    missingParents: [...missingParents].sort(),
    conflictingParents,
  };
}

export function findForkBaselineCheckpoint(
  parent: ForkSessionSourceV5,
  forkTimestamp: number,
): ForkBaselineCheckpointV5 | undefined {
  const candidates = orderedEvents(parent.events)
    .filter((event) => event.timestamp !== undefined && event.timestamp < forkTimestamp)
    .flatMap((event) => {
      const rawTotal = event.tokenCount?.total;
      const aggregateTotal = rawTotal ? effectiveAggregateTotal(rawTotal) : undefined;
      return rawTotal && event.timestamp !== undefined && aggregateTotal !== undefined
        ? [{ parentSessionId: parent.sessionId, event, rawTotal, aggregateTotal, timestamp: event.timestamp }]
        : [];
    });
  return candidates.sort((left, right) =>
    right.timestamp - left.timestamp ||
    right.event.eventIndex - left.event.eventIndex ||
    right.event.rawIdentity.localeCompare(left.event.rawIdentity)).at(0);
}

const baselineDiagnostics = (): ForkBaselineDiagnosticsV5 => ({
  forkSessions: 0,
  resolvedBaselineSessions: 0,
  explicitReplaySessions: 0,
  noReplaySessions: 0,
  missingParentSessions: 0,
  missingForkTimestampSessions: 0,
  missingParentCheckpointSessions: 0,
  missingChildTotalTimestampSessions: 0,
  counterResetAtForkSessions: 0,
  incomparableBaselineSessions: 0,
  cycleSessions: 0,
  replaySuppressedEvents: 0,
  replaySuppressedTokens: 0,
  partialReplayBlockedEvents: 0,
  missingReplayIdentityEvents: 0,
  replayPrefixMismatchSessions: 0,
  conflictingParentSessions: 0,
});

const cycleSessions = (graph: ForkSessionGraphV5): Set<string> =>
  new Set(graph.cycles.flat());

export function resolveForkBaselinesV5(
  sessions: readonly ForkSessionSourceV5[],
): ForkBaselinePlanV5 {
  const graph = buildForkSessionGraphV5(sessions);
  const diagnostics = baselineDiagnostics();
  const resolutions = new Map<string, ForkBaselineResolutionV5>();
  const cycles = cycleSessions(graph);
  for (const session of orderedSessions(sessions)) {
    const resolution: ForkBaselineResolutionV5 = {
      sessionId: session.sessionId,
      parentSessionId: session.parentSessionId,
      status: "not-fork",
    };
    if (!session.parentSessionId) {
      diagnostics.noReplaySessions += 1;
      resolutions.set(session.sessionId, resolution);
      continue;
    }
    diagnostics.forkSessions += 1;
    if (graph.conflictingParents.includes(session.sessionId)) {
      resolution.status = "conflicting-parent";
      diagnostics.conflictingParentSessions += 1;
    } else if (cycles.has(session.sessionId)) {
      resolution.status = "cycle";
      diagnostics.cycleSessions += 1;
    } else if (!graph.nodes.get(session.sessionId)?.parent) {
      resolution.status = "missing-parent";
      diagnostics.missingParentSessions += 1;
    } else if (session.forkTimestamp === undefined) {
      resolution.status = "missing-fork-timestamp";
      diagnostics.missingForkTimestampSessions += 1;
    } else if (orderedEvents(session.events).some((event) => hasUsageEvent(event) && event.timestamp !== undefined && event.timestamp < session.forkTimestamp!)) {
      resolution.status = "explicit-replay";
      diagnostics.explicitReplaySessions += 1;
    } else {
      const parent = graph.nodes.get(session.sessionId)?.parent!;
      const checkpoint = findForkBaselineCheckpoint(parent, session.forkTimestamp);
      const firstChildTotalEvent = [...session.events]
        .filter((event) => !!event.tokenCount?.total)
        .sort((left, right) => left.eventIndex - right.eventIndex || left.rawIdentity.localeCompare(right.rawIdentity))
        .at(0);
      resolution.checkpoint = checkpoint;
      resolution.firstChildTotalEvent = firstChildTotalEvent;
      if (!checkpoint) {
        resolution.status = "missing-parent-checkpoint";
        diagnostics.missingParentCheckpointSessions += 1;
      } else if (!firstChildTotalEvent?.tokenCount?.total) {
        resolution.status = "not-needed";
        diagnostics.noReplaySessions += 1;
      } else if (firstChildTotalEvent.timestamp === undefined) {
        resolution.status = "missing-child-total-timestamp";
        diagnostics.missingChildTotalTimestampSessions += 1;
      } else {
        const initialState: TokenCountState = {
          previousTotalRaw: checkpoint.rawTotal,
          previousAggregateTotal: checkpoint.aggregateTotal,
          segment: 0,
        };
        const comparison = compareRawCumulative(firstChildTotalEvent.tokenCount.total, initialState);
        if (comparison.relation === "reset") {
          resolution.status = "child-counter-reset";
          diagnostics.counterResetAtForkSessions += 1;
          resolution.checkpoint = checkpoint;
          resolution.firstChildTotalEvent = firstChildTotalEvent;
        } else if (comparison.relation === "incomparable") {
          resolution.status = "incomparable";
          diagnostics.incomparableBaselineSessions += 1;
        } else {
          const contribution = deriveTokenCountContribution(firstChildTotalEvent, initialState);
          resolution.status = "resolved";
          resolution.initialState = initialState;
          resolution.previewMethod = contribution?.method;
          resolution.inheritedAggregate = checkpoint.aggregateTotal;
          resolution.previewContributionAggregate = contribution ? totalTokens(contribution.usage) : undefined;
          diagnostics.resolvedBaselineSessions += 1;
        }
      }
    }
    resolutions.set(session.sessionId, resolution);
  }
  return { graph, resolutions, diagnostics };
}

export function canonicalUsageFromTokenCount(
  ref: CanonicalTokenCountRef,
): CanonicalUsageContributionV5 {
  return {
    event: ref.event,
    usage: ref.usage,
    aggregateTotal: ref.aggregateTotal,
    precision: ref.precision,
    sourceKind: "token-count",
  };
}

export function canonicalUsageFromPayloadFallback(
  fallback: PayloadFallbackContribution,
): CanonicalUsageContributionV5 {
  return {
    event: fallback.event,
    usage: fallback.usage,
    aggregateTotal: fallback.aggregateTotal,
    precision: fallback.precision,
    sourceKind: "payload-fallback",
  };
}

export function sameForkReplayContribution(
  parent: CanonicalUsageContributionV5,
  child: CanonicalUsageContributionV5,
): boolean {
  if (parent.event.timestamp === undefined || child.event.timestamp === undefined || parent.event.timestamp !== child.event.timestamp)
    return false;
  const identity = compareForkReplayIdentity(parent.event, child.event);
  if (!identity.compatible) return false;
  if (parent.event.model && child.event.model && parent.event.model !== child.event.model) return false;
  if (parent.precision === "partial" || child.precision === "partial") return false;
  if (parent.precision === "components-exact" && child.precision === "components-exact")
    return sameUsageComponents(parent.usage, child.usage);
  return parent.aggregateTotal === child.aggregateTotal;
}

const replayDiagnostics = (): ForkReplayDiagnosticsV5 => ({
  forkSessions: 0,
  resolvedBaselineSessions: 0,
  explicitReplaySessions: 0,
  noReplaySessions: 0,
  missingParentSessions: 0,
  missingForkTimestampSessions: 0,
  missingParentCheckpointSessions: 0,
  missingChildTotalTimestampSessions: 0,
  counterResetAtForkSessions: 0,
  incomparableBaselineSessions: 0,
  cycleSessions: 0,
  replaySuppressedEvents: 0,
  replaySuppressedTokens: 0,
  partialReplayBlockedEvents: 0,
  missingReplayIdentityEvents: 0,
  replayPrefixMismatchSessions: 0,
  conflictingParentSessions: 0,
});

const replayStatusFor = (
  session: ForkCanonicalSessionV5,
  graph: ForkSessionGraphV5,
  cycles: Set<string>,
): ForkReplaySessionStatus => {
  if (!session.parentSessionId) return "not-fork";
  if (graph.conflictingParents.includes(session.sessionId)) return "conflicting-parent";
  if (cycles.has(session.sessionId)) return "cycle";
  if (!graph.nodes.get(session.sessionId)?.parent) return "missing-parent";
  if (session.forkTimestamp === undefined) return "missing-fork-timestamp";
  return "resolved";
};

const sessionSourceOf = (session: ForkCanonicalSessionV5): ForkSessionSourceV5 => ({
  sessionId: session.sessionId,
  parentSessionId: session.parentSessionId,
  forkTimestamp: session.forkTimestamp,
  events: session.contributions.map((contribution) => contribution.event),
});

export function resolveForkReplayV5(
  sessions: readonly ForkCanonicalSessionV5[],
): ForkReplayResultV5 {
  const ordered = [...sessions].sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  const graph = buildForkSessionGraphV5(ordered.map(sessionSourceOf));
  const cycles = cycleSessions(graph);
  const diagnostics = replayDiagnostics();
  const results: ForkReplaySessionResultV5[] = [];
  for (const session of ordered) {
    const status = replayStatusFor(session, graph, cycles);
    if (status === "not-fork") diagnostics.noReplaySessions += 1;
    else {
      diagnostics.forkSessions += 1;
      if (status === "missing-parent") diagnostics.missingParentSessions += 1;
      if (status === "missing-fork-timestamp") diagnostics.missingForkTimestampSessions += 1;
      if (status === "cycle") diagnostics.cycleSessions += 1;
      if (status === "conflicting-parent") diagnostics.conflictingParentSessions += 1;
    }
    const parent = status === "resolved" ? graph.nodes.get(session.sessionId)?.parent : undefined;
    const parentSession = parent ? ordered.find((candidate) => candidate.sessionId === parent.sessionId) : undefined;
    const suppressed: ForkReplaySuppressionV5[] = [];
    const suppressedIndexes = new Set<number>();
    const forkTimestamp = session.forkTimestamp;
    const childContributions = orderedContributions(session.contributions);
    const childCandidates = forkTimestamp === undefined
      ? []
      : childContributions
        .map((contribution, index) => ({ contribution, index }))
        .filter(({ contribution }) => contribution.event.timestamp !== undefined && contribution.event.timestamp < forkTimestamp);
    const parentContributions = parentSession ? orderedContributions(parentSession.contributions) : [];
    const parentCandidates = forkTimestamp === undefined || !parentSession
      ? []
      : parentContributions
        .map((contribution, index) => ({ contribution, index }))
        .filter(({ contribution }) => contribution.event.timestamp !== undefined && contribution.event.timestamp < forkTimestamp);
    if (status === "resolved" && parentSession) {
      const limit = Math.min(childCandidates.length, parentCandidates.length);
      let prefixStopped = false;
      for (let index = 0; index < limit; index += 1) {
        const child = childCandidates[index]!;
        const parentContribution = parentCandidates[index]!;
        if (!sameForkReplayContribution(parentContribution.contribution, child.contribution)) {
          prefixStopped = true;
          if (parentContribution.contribution.precision === "partial" || child.contribution.precision === "partial") diagnostics.partialReplayBlockedEvents += 1;
          if (!hasReplayIdentity(parentContribution.contribution.event) || !hasReplayIdentity(child.contribution.event)) diagnostics.missingReplayIdentityEvents += 1;
          break;
        }
        suppressedIndexes.add(child.index);
        suppressed.push({
          child: child.contribution,
          parent: parentContribution.contribution,
          childIndex: child.index,
          parentIndex: parentContribution.index,
          suppressedTokens: child.contribution.aggregateTotal,
        });
      }
      if (prefixStopped || childCandidates.length !== suppressed.length) diagnostics.replayPrefixMismatchSessions += 1;
    }
    const kept = childContributions.filter((_, index) => !suppressedIndexes.has(index));
    const replayPrefixTokens = suppressed.reduce((sum, item) => sum + item.suppressedTokens, 0);
    diagnostics.replaySuppressedEvents += suppressed.length;
    diagnostics.replaySuppressedTokens += replayPrefixTokens;
    if (status === "resolved") {
      if (childCandidates.length && suppressed.length === childCandidates.length) diagnostics.explicitReplaySessions += 1;
      else diagnostics.resolvedBaselineSessions += 1;
      if (!childCandidates.length) diagnostics.noReplaySessions += 1;
    }
    results.push({
      sessionId: session.sessionId,
      parentSessionId: session.parentSessionId,
      status,
      suppressed,
      kept,
      replayPrefixCount: suppressed.length,
      replayPrefixTokens,
    });
  }
  const inputContributions = ordered.reduce((sum, session) => sum + session.contributions.length, 0);
  const keptContributions = results.reduce((sum, result) => sum + result.kept.length, 0);
  const suppressedContributions = results.reduce((sum, result) => sum + result.suppressed.length, 0);
  const inputTokens = ordered.reduce((sum, session) => sum + session.contributions.reduce((inner, contribution) => inner + contribution.aggregateTotal, 0), 0);
  const keptTokens = results.reduce((sum, result) => sum + result.kept.reduce((inner, contribution) => inner + contribution.aggregateTotal, 0), 0);
  return {
    sessions: results,
    diagnostics,
    contributionInvariant: inputContributions === keptContributions + suppressedContributions,
    tokenInvariant: inputTokens === keptTokens + diagnostics.replaySuppressedTokens,
  };
}
