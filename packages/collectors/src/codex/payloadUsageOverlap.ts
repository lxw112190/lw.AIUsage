import { totalTokens, type TokenUsage } from "@lw-aiusage/core";
import { objectValue, stableEventId, stableHash, stringValue } from "../shared/identity";
import {
  counterDecrease,
  normalizeRawCounters,
  positiveRawDelta,
  rawCountersFrom,
  type CodexRawCounters,
  zeroRawCounters,
} from "./accounting";
import { canonicalizeMirrorFiles } from "./mirrorFileReconcile";
import type { CodexExtractedEvent, CodexExtractedFile } from "./rawAuditTypes";

export type PayloadLinkEvidence =
  | "same-response-id"
  | "same-turn-id"
  | "exact-usage-near-time"
  | "exact-usage-wide-time"
  | "same-total-near-time"
  | "none";

export type PayloadLinkConfidence =
  | "exact"
  | "probable"
  | "possible"
  | "weak"
  | "ambiguous"
  | "unmatched";

export type PayloadUsageRelation =
  | "same-components"
  | "same-total-different-components"
  | "different"
  | "unknown";

export type PayloadDuplicateClass =
  | "confirmed"
  | "probable"
  | "possible"
  | "linked-different-usage"
  | "weak-candidate"
  | "ambiguous"
  | "unmatched";

export interface UsageCount {
  events: number;
  tokens: number;
}

export interface PayloadUsageUniverse {
  observed: UsageCount;
  parserV4Eligible: UsageCount;
  shadowedByHigherPriority: UsageCount;
}

export interface CodexUsageEventRef {
  stableId: string;
  sessionId: string;
  timestamp?: number;
  turnId?: string;
  responseId?: string;
  model?: string;
  semanticType?: string;
  source: "token-count" | "payload-usage";
  usage: TokenUsage;
  rawCounters?: CodexRawCounters;
  hasTokenContribution: boolean;
  parserV4Eligible: boolean;
}

export interface PayloadUsageMatch {
  payload: CodexUsageEventRef;
  tokenCount?: CodexUsageEventRef;
  evidence: PayloadLinkEvidence;
  linkConfidence: PayloadLinkConfidence;
  usageRelation: PayloadUsageRelation;
  duplicateClass: PayloadDuplicateClass;
  timeDeltaMs?: number;
}

export interface PayloadOverlapDay {
  day: string;
  tokenCountTokens: number;
  observedPayloadTokens: number;
  eligiblePayloadTokens: number;
  confirmedDuplicateTokens: number;
  probableDuplicateTokens: number;
  possibleDuplicateTokens: number;
  linkedDifferentUsageTokens: number;
  weakCandidateTokens: number;
  ambiguousTokens: number;
  unmatchedTokens: number;
}

export interface PayloadOverlapSample {
  sessionHash: string;
  payloadRecordHash: string;
  tokenCountRecordHash?: string;
  evidence: PayloadLinkEvidence;
  linkConfidence: PayloadLinkConfidence;
  usageRelation: PayloadUsageRelation;
  duplicateClass: PayloadDuplicateClass;
  timeDeltaMs?: number;
  payloadTokens: number;
  tokenCountTokens?: number;
}

export interface PayloadOverlapModel {
  model: string;
  payloadEvents: number;
  payloadTokens: number;
  confirmedDuplicateTokens: number;
  probableDuplicateTokens: number;
  possibleDuplicateTokens: number;
  linkedDifferentUsageTokens: number;
  weakCandidateTokens: number;
  ambiguousTokens: number;
  unmatchedTokens: number;
}

interface OverlapCount extends UsageCount {}

export interface PayloadUsageOverlapReport {
  payloadUniverse: PayloadUsageUniverse;
  tokenCount: UsageCount;
  duplicateClassification: {
    confirmed: OverlapCount;
    probable: OverlapCount;
    possible: OverlapCount;
    linkedDifferentUsage: OverlapCount;
    weakCandidate: OverlapCount;
    ambiguous: OverlapCount;
    unmatched: OverlapCount;
  };
  linkSummary: {
    exact: OverlapCount;
    probable: OverlapCount;
    possible: OverlapCount;
    weak: OverlapCount;
    ambiguous: OverlapCount;
    unmatched: OverlapCount;
  };
  byEvidence: Record<PayloadLinkEvidence, OverlapCount>;
  bySemanticType: Record<string, OverlapCount>;
  byModel: PayloadOverlapModel[];
  peakDays: PayloadOverlapDay[];
  samples: PayloadOverlapSample[];
  confirmedDuplicateTokens: number;
  linkedTokens: number;
  candidateLinkedTokens: number;
  notConfirmedDuplicateTokens: number;
  payloadUniverseEventInvariant: boolean;
  payloadUniverseTokenInvariant: boolean;
  payloadTokenInvariant: boolean;
  payloadEventInvariant: boolean;
  payloadClassificationInvariant: boolean;
}

const evidenceValues: PayloadLinkEvidence[] = [
  "same-response-id", "same-turn-id", "exact-usage-near-time",
  "exact-usage-wide-time", "same-total-near-time", "none",
];
const dayFieldOf: Record<PayloadDuplicateClass, keyof PayloadOverlapDay> = {
  confirmed: "confirmedDuplicateTokens",
  probable: "probableDuplicateTokens",
  possible: "possibleDuplicateTokens",
  "linked-different-usage": "linkedDifferentUsageTokens",
  "weak-candidate": "weakCandidateTokens",
  ambiguous: "ambiguousTokens",
  unmatched: "unmatchedTokens",
};
const emptyCount = (): OverlapCount => ({ events: 0, tokens: 0 });
const emptyRecord = <T extends string>(values: readonly T[]): Record<T, OverlapCount> =>
  Object.fromEntries(values.map((value) => [value, emptyCount()])) as Record<T, OverlapCount>;
const cloneRaw = (value: CodexRawCounters): CodexRawCounters => ({ ...value });

const rawCountersWithPresence = (value: unknown): CodexRawCounters | undefined => {
  const object = objectValue(value);
  if (!object) return undefined;
  const hasField = [
    "input_tokens", "inputTokens", "cached_input_tokens", "cachedInputTokens",
    "cache_creation_input_tokens", "cacheCreationInputTokens", "cache_write_input_tokens",
    "output_tokens", "outputTokens", "total_tokens", "totalTokens",
    "reasoning_output_tokens", "reasoningOutputTokens",
  ].some((key) => key in object);
  if (!hasField) return undefined;
  return rawCountersFrom(value) ?? zeroRawCounters();
};

const timestampOf = (event: CodexExtractedEvent): number | undefined => {
  const value = event.raw.timestamp;
  if (typeof value === "number" && Number.isFinite(value))
    return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return event.explicitTimestamp;
};

const payloadOf = (event: CodexExtractedEvent): Record<string, unknown> =>
  objectValue(event.raw.payload) ?? event.raw;

const usageNodesOf = (event: CodexExtractedEvent): {
  lastNode?: unknown;
  totalNode?: unknown;
  last?: CodexRawCounters;
  total?: CodexRawCounters;
} => {
  const payload = payloadOf(event);
  const msg = objectValue(payload.msg);
  const info = objectValue(payload.info) ?? objectValue(msg?.info) ?? objectValue(event.raw.info);
  const lastNode = info?.last_token_usage ?? info?.lastTokenUsage;
  const totalNode = info?.total_token_usage ?? info?.totalTokenUsage;
  return { lastNode, totalNode, last: rawCountersWithPresence(lastNode), total: rawCountersWithPresence(totalNode) };
};

const refOf = (
  file: CodexExtractedFile,
  event: CodexExtractedEvent,
  source: "token-count" | "payload-usage",
  rawNode: unknown,
  rawCounters: CodexRawCounters | undefined,
  parserV4Eligible: boolean,
): CodexUsageEventRef | undefined => {
  if (!rawCounters) return undefined;
  const payload = payloadOf(event);
  const msg = objectValue(payload.msg);
  const sessionId = event.resolvedSessionId ?? file.finalSessionId ?? `file:${file.entry.path}`;
  const responseId = stringValue(payload.response_id) ?? stringValue(payload.responseId) ?? stringValue(msg?.response_id) ?? stringValue(msg?.responseId);
  const turnId = stringValue(payload.turn_id) ?? stringValue(payload.turnId) ?? stringValue(msg?.turn_id) ?? stringValue(msg?.turnId);
  const stableId = stableEventId("codex", file.peekLogicalId ?? sessionId ?? file.entry.path, event.raw, {
    timestamp: event.raw.timestamp,
    turnId,
    responseId,
    total: rawNode,
  });
  const usage = normalizeRawCounters(rawCounters);
  return {
    stableId,
    sessionId,
    timestamp: timestampOf(event),
    turnId,
    responseId,
    model: event.resolvedModel,
    semanticType: event.semanticType,
    source,
    usage,
    rawCounters: cloneRaw(rawCounters),
    hasTokenContribution: totalTokens(usage) > 0,
    parserV4Eligible,
  };
};

/** Derives TokenCount contributions for overlap diagnostics only; it is not Parser v5 accounting. */
export function collectTokenCountRefs(files: readonly CodexExtractedFile[]): CodexUsageEventRef[] {
  const refs: CodexUsageEventRef[] = [];
  const previousBySession = new Map<string, CodexRawCounters>();
  for (const file of canonicalizeMirrorFiles(files)) {
    const fileSession = file.finalSessionId ?? file.peekLogicalId ?? `file:${file.entry.path}`;
    for (const event of file.events) {
      if (!event.isTokenCount) continue;
      const sessionId = event.resolvedSessionId ?? fileSession;
      const nodes = usageNodesOf(event);
      let contribution: CodexRawCounters | undefined;
      if (nodes.total) {
        const previous = previousBySession.get(sessionId);
        contribution = !previous
          ? cloneRaw(nodes.total)
          : counterDecrease(nodes.total, previous)
            ? cloneRaw(nodes.total)
            : positiveRawDelta(nodes.total, previous);
        previousBySession.set(sessionId, cloneRaw(nodes.total));
      }
      if (nodes.last) contribution = cloneRaw(nodes.last);
      const ref = refOf(file, event, "token-count", nodes.lastNode ?? nodes.totalNode, contribution, true);
      if (ref) {
        ref.hasTokenContribution = totalTokens(ref.usage) > 0;
        refs.push(ref);
      }
    }
  }
  return refs;
}

export function collectCodexUsageEventRefs(files: readonly CodexExtractedFile[]): {
  tokenCount: CodexUsageEventRef[];
  payloadUsage: CodexUsageEventRef[];
} {
  const payloadUsage: CodexUsageEventRef[] = [];
  const canonical = canonicalizeMirrorFiles(files);
  for (const file of canonical) {
    for (const event of file.events) {
      const payload = payloadOf(event);
      const payloadNode = objectValue(payload.usage);
      const payloadRef = refOf(file, event, "payload-usage", payloadNode, rawCountersWithPresence(payloadNode), event.source === "payload-usage");
      if (payloadRef) payloadUsage.push(payloadRef);
    }
  }
  return { tokenCount: collectTokenCountRefs(canonical), payloadUsage };
}

const sameUsageExact = (left: TokenUsage, right: TokenUsage): boolean =>
  left.inputTokens === right.inputTokens &&
  left.cachedInputTokens === right.cachedInputTokens &&
  left.cacheCreationInputTokens === right.cacheCreationInputTokens &&
  left.outputTokens === right.outputTokens &&
  left.reasoningOutputTokens === right.reasoningOutputTokens;
const usageRelation = (payload: TokenUsage, token: TokenUsage | undefined): PayloadUsageRelation => {
  if (!token) return "unknown";
  if (sameUsageExact(payload, token)) return "same-components";
  if (totalTokens(payload) === totalTokens(token)) return "same-total-different-components";
  return "different";
};
const timeDelta = (left: CodexUsageEventRef, right: CodexUsageEventRef): number | undefined =>
  left.timestamp === undefined || right.timestamp === undefined ? undefined : Math.abs(left.timestamp - right.timestamp);
const within = (left: CodexUsageEventRef, right: CodexUsageEventRef, limit: number, minimum = -1): boolean => {
  const delta = timeDelta(left, right);
  return delta !== undefined && delta > minimum && delta <= limit;
};
const compareRef = (left: CodexUsageEventRef, right: CodexUsageEventRef): number =>
  (left.timestamp ?? 0) - (right.timestamp ?? 0) || left.stableId.localeCompare(right.stableId);

function duplicateClassOf(confidence: PayloadLinkConfidence, evidence: PayloadLinkEvidence, relation: PayloadUsageRelation): PayloadDuplicateClass {
  if (confidence === "ambiguous") return "ambiguous";
  if (confidence === "unmatched") return "unmatched";
  if (confidence === "weak") return "weak-candidate";
  if (relation !== "same-components") return "linked-different-usage";
  if (evidence === "same-response-id" && confidence === "exact") return "confirmed";
  if (confidence === "probable") return "probable";
  if (confidence === "possible") return "possible";
  return "linked-different-usage";
}

interface MatchPass {
  evidence: PayloadLinkEvidence;
  confidence: PayloadLinkConfidence;
  candidate: (payload: CodexUsageEventRef, token: CodexUsageEventRef) => boolean;
  narrow?: (payload: CodexUsageEventRef, tokens: CodexUsageEventRef[]) => CodexUsageEventRef[];
}

interface PayloadMatchState {
  payloads: readonly CodexUsageEventRef[];
  tokens: readonly CodexUsageEventRef[];
  matches: Map<number, PayloadUsageMatch>;
  usedPayloads: Set<number>;
  usedTokens: Set<number>;
  ambiguousEvidence: Map<number, { evidence: PayloadLinkEvidence; confidence: PayloadLinkConfidence }>;
}

const confidenceRank: Record<PayloadLinkConfidence, number> = {
  exact: 6, probable: 5, possible: 4, weak: 3, ambiguous: 2, unmatched: 1,
};
const recordAmbiguous = (state: PayloadMatchState, index: number, pass: MatchPass): void => {
  const current = state.ambiguousEvidence.get(index);
  if (!current || confidenceRank[pass.confidence] > confidenceRank[current.confidence])
    state.ambiguousEvidence.set(index, { evidence: pass.evidence, confidence: pass.confidence });
};
const acceptMatch = (state: PayloadMatchState, payloadIndex: number, tokenIndex: number, pass: MatchPass): void => {
  const payload = state.payloads[payloadIndex]!;
  const token = state.tokens[tokenIndex]!;
  const relation = usageRelation(payload.usage, token.usage);
  state.matches.set(payloadIndex, {
    payload,
    tokenCount: token,
    evidence: pass.evidence,
    linkConfidence: pass.confidence,
    usageRelation: relation,
    duplicateClass: duplicateClassOf(pass.confidence, pass.evidence, relation),
    timeDeltaMs: timeDelta(payload, token),
  });
  state.usedPayloads.add(payloadIndex);
  state.usedTokens.add(tokenIndex);
};

function runMatchPass(state: PayloadMatchState, pass: MatchPass): void {
  const payloadCandidates = new Map<number, number[]>();
  const tokenCandidates = new Map<number, number[]>();
  for (let payloadIndex = 0; payloadIndex < state.payloads.length; payloadIndex += 1) {
    if (state.usedPayloads.has(payloadIndex)) continue;
    const payload = state.payloads[payloadIndex]!;
    const candidateTokens = state.tokens
      .map((token, tokenIndex) => ({ token, tokenIndex }))
      .filter(({ token, tokenIndex }) => !state.usedTokens.has(tokenIndex) && token.sessionId === payload.sessionId && pass.candidate(payload, token));
    const narrowed = pass.narrow?.(payload, candidateTokens.map(({ token }) => token)) ?? candidateTokens.map(({ token }) => token);
    const candidateIndexes = narrowed
      .map((token) => state.tokens.indexOf(token))
      .filter((tokenIndex) => tokenIndex >= 0 && !state.usedTokens.has(tokenIndex));
    if (candidateIndexes.length) payloadCandidates.set(payloadIndex, candidateIndexes);
  }
  for (const [payloadIndex, tokenIndexes] of payloadCandidates) {
    for (const tokenIndex of tokenIndexes) {
      const values = tokenCandidates.get(tokenIndex) ?? [];
      values.push(payloadIndex);
      tokenCandidates.set(tokenIndex, values);
    }
  }
  for (const [payloadIndex, tokenIndexes] of payloadCandidates) {
    if (tokenIndexes.length === 1 && tokenCandidates.get(tokenIndexes[0]!)?.length === 1) {
      acceptMatch(state, payloadIndex, tokenIndexes[0]!, pass);
    } else {
      recordAmbiguous(state, payloadIndex, pass);
      for (const tokenIndex of tokenIndexes)
        if ((tokenCandidates.get(tokenIndex)?.length ?? 0) > 1)
          for (const otherPayload of tokenCandidates.get(tokenIndex)!) recordAmbiguous(state, otherPayload, pass);
    }
  }
}

const dayOf = (timestamp?: number): string | undefined => {
  if (timestamp === undefined) return undefined;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** All duplicate/link classifications below use parserV4Eligible payload.usage events only. */
export function auditCodexPayloadUsageOverlap(files: readonly CodexExtractedFile[]): PayloadUsageOverlapReport {
  const refs = collectCodexUsageEventRefs(files);
  const observed = refs.payloadUsage.reduce((count, ref) => ({ events: count.events + 1, tokens: count.tokens + totalTokens(ref.usage) }), emptyCount());
  const eligiblePayloads = refs.payloadUsage.filter((ref) => ref.parserV4Eligible).sort(compareRef);
  const tokens = [...refs.tokenCount].sort(compareRef);
  const eligible = eligiblePayloads.reduce((count, ref) => ({ events: count.events + 1, tokens: count.tokens + totalTokens(ref.usage) }), emptyCount());
  const payloadMatchState: PayloadMatchState = { payloads: eligiblePayloads, tokens, matches: new Map(), usedPayloads: new Set(), usedTokens: new Set(), ambiguousEvidence: new Map() };
  const exactComponentNarrow = (payload: CodexUsageEventRef, candidates: CodexUsageEventRef[]): CodexUsageEventRef[] => {
    const same = candidates.filter((token) => sameUsageExact(payload.usage, token.usage));
    return same.length === 1 ? same : candidates;
  };
  runMatchPass(payloadMatchState, {
    evidence: "same-response-id",
    confidence: "exact",
    candidate: (payload, token) => !!payload.responseId && payload.responseId === token.responseId,
    narrow: exactComponentNarrow,
  });
  runMatchPass(payloadMatchState, {
    evidence: "same-turn-id",
    confidence: "probable",
    candidate: (payload, token) => !!payload.turnId && payload.turnId === token.turnId,
    narrow: exactComponentNarrow,
  });
  runMatchPass(payloadMatchState, {
    evidence: "exact-usage-near-time",
    confidence: "probable",
    candidate: (payload, token) => token.hasTokenContribution && sameUsageExact(payload.usage, token.usage) && within(payload, token, 1_000),
  });
  runMatchPass(payloadMatchState, {
    evidence: "exact-usage-wide-time",
    confidence: "possible",
    candidate: (payload, token) => token.hasTokenContribution && sameUsageExact(payload.usage, token.usage) && within(payload, token, 10_000, 1_000),
  });
  runMatchPass(payloadMatchState, {
    evidence: "same-total-near-time",
    confidence: "weak",
    candidate: (payload, token) => token.hasTokenContribution && !sameUsageExact(payload.usage, token.usage) && totalTokens(payload.usage) === totalTokens(token.usage) && within(payload, token, 10_000),
  });
  for (let payloadIndex = 0; payloadIndex < eligiblePayloads.length; payloadIndex += 1) {
    if (payloadMatchState.matches.has(payloadIndex)) continue;
    const ambiguous = payloadMatchState.ambiguousEvidence.get(payloadIndex);
    const payload = eligiblePayloads[payloadIndex]!;
    const evidence = ambiguous?.evidence ?? "none";
    const confidence = ambiguous?.confidence === "weak" ? "weak" : ambiguous ? "ambiguous" : "unmatched";
    const relation = confidence === "weak" ? "same-total-different-components" : "unknown";
    payloadMatchState.matches.set(payloadIndex, {
      payload,
      evidence,
      linkConfidence: confidence,
      usageRelation: relation,
      duplicateClass: duplicateClassOf(confidence, evidence, relation),
    });
  }

  const duplicateClassification = {
    confirmed: emptyCount(), probable: emptyCount(), possible: emptyCount(), linkedDifferentUsage: emptyCount(),
    weakCandidate: emptyCount(), ambiguous: emptyCount(), unmatched: emptyCount(),
  };
  const linkSummary = { exact: emptyCount(), probable: emptyCount(), possible: emptyCount(), weak: emptyCount(), ambiguous: emptyCount(), unmatched: emptyCount() };
  const byEvidence = emptyRecord(evidenceValues);
  const bySemanticType: Record<string, OverlapCount> = {};
  const byModel = new Map<string, PayloadOverlapModel>();
  const days = new Map<string, PayloadOverlapDay>();
  const matches = [...payloadMatchState.matches.values()].sort((left, right) => compareRef(left.payload, right.payload));
  for (const match of matches) {
    const tokensForPayload = totalTokens(match.payload.usage);
    const duplicateKey = (match.duplicateClass === "linked-different-usage" ? "linkedDifferentUsage" : match.duplicateClass === "weak-candidate" ? "weakCandidate" : match.duplicateClass) as keyof typeof duplicateClassification;
    duplicateClassification[duplicateKey].events += 1;
    duplicateClassification[duplicateKey].tokens += tokensForPayload;
    linkSummary[match.linkConfidence].events += 1;
    linkSummary[match.linkConfidence].tokens += tokensForPayload;
    byEvidence[match.evidence].events += 1;
    byEvidence[match.evidence].tokens += tokensForPayload;
    const semantic = match.payload.semanticType ?? "unknown";
    const semanticCount = bySemanticType[semantic] ?? emptyCount();
    semanticCount.events += 1;
    semanticCount.tokens += tokensForPayload;
    bySemanticType[semantic] = semanticCount;
    const model = match.payload.model ?? "unknown";
    const modelCount = byModel.get(model) ?? { model, payloadEvents: 0, payloadTokens: 0, confirmedDuplicateTokens: 0, probableDuplicateTokens: 0, possibleDuplicateTokens: 0, linkedDifferentUsageTokens: 0, weakCandidateTokens: 0, ambiguousTokens: 0, unmatchedTokens: 0 };
    modelCount.payloadEvents += 1;
    modelCount.payloadTokens += tokensForPayload;
    const modelField = dayFieldOf[match.duplicateClass];
    (modelCount as unknown as Record<string, number>)[modelField] = ((modelCount as unknown as Record<string, number>)[modelField] ?? 0) + tokensForPayload;
    byModel.set(model, modelCount);
    const day = dayOf(match.payload.timestamp);
    if (day) {
      const daySummary = days.get(day) ?? { day, tokenCountTokens: 0, observedPayloadTokens: 0, eligiblePayloadTokens: 0, confirmedDuplicateTokens: 0, probableDuplicateTokens: 0, possibleDuplicateTokens: 0, linkedDifferentUsageTokens: 0, weakCandidateTokens: 0, ambiguousTokens: 0, unmatchedTokens: 0 };
      daySummary.eligiblePayloadTokens += tokensForPayload;
      const field = dayFieldOf[match.duplicateClass];
      const dayValues = daySummary as unknown as Record<string, number>;
      dayValues[field] = (dayValues[field] ?? 0) + tokensForPayload;
      days.set(day, daySummary);
    }
  }
  for (const ref of refs.payloadUsage) {
    const day = dayOf(ref.timestamp);
    if (!day) continue;
    const daySummary = days.get(day) ?? { day, tokenCountTokens: 0, observedPayloadTokens: 0, eligiblePayloadTokens: 0, confirmedDuplicateTokens: 0, probableDuplicateTokens: 0, possibleDuplicateTokens: 0, linkedDifferentUsageTokens: 0, weakCandidateTokens: 0, ambiguousTokens: 0, unmatchedTokens: 0 };
    daySummary.observedPayloadTokens += totalTokens(ref.usage);
    days.set(day, daySummary);
  }
  for (const token of tokens) {
    const day = dayOf(token.timestamp);
    if (!day) continue;
    const daySummary = days.get(day) ?? { day, tokenCountTokens: 0, observedPayloadTokens: 0, eligiblePayloadTokens: 0, confirmedDuplicateTokens: 0, probableDuplicateTokens: 0, possibleDuplicateTokens: 0, linkedDifferentUsageTokens: 0, weakCandidateTokens: 0, ambiguousTokens: 0, unmatchedTokens: 0 };
    daySummary.tokenCountTokens += totalTokens(token.usage);
    days.set(day, daySummary);
  }
  const classifiedTokens = Object.values(duplicateClassification).reduce((sum, count) => sum + count.tokens, 0);
  const classifiedEvents = Object.values(duplicateClassification).reduce((sum, count) => sum + count.events, 0);
  const linkedTokens = linkSummary.exact.tokens + linkSummary.probable.tokens + linkSummary.possible.tokens;
  const candidateLinkedTokens = linkedTokens + linkSummary.weak.tokens + linkSummary.ambiguous.tokens;
  const tokenCount = { events: tokens.length, tokens: tokens.reduce((sum, ref) => sum + totalTokens(ref.usage), 0) };
  return {
    payloadUniverse: {
      observed,
      parserV4Eligible: eligible,
      shadowedByHigherPriority: { events: observed.events - eligible.events, tokens: observed.tokens - eligible.tokens },
    },
    tokenCount,
    duplicateClassification,
    linkSummary,
    byEvidence,
    bySemanticType,
    byModel: [...byModel.values()].sort((left, right) => right.payloadTokens - left.payloadTokens),
    peakDays: [...days.values()].sort((left, right) => right.eligiblePayloadTokens - left.eligiblePayloadTokens).slice(0, 20),
    samples: matches.slice(0, 20).map((match) => ({
      sessionHash: stableHash(match.payload.sessionId),
      payloadRecordHash: stableHash(match.payload.stableId),
      tokenCountRecordHash: match.tokenCount ? stableHash(match.tokenCount.stableId) : undefined,
      evidence: match.evidence,
      linkConfidence: match.linkConfidence,
      usageRelation: match.usageRelation,
      duplicateClass: match.duplicateClass,
      timeDeltaMs: match.timeDeltaMs,
      payloadTokens: totalTokens(match.payload.usage),
      tokenCountTokens: match.tokenCount ? totalTokens(match.tokenCount.usage) : undefined,
    })),
    confirmedDuplicateTokens: duplicateClassification.confirmed.tokens,
    linkedTokens,
    candidateLinkedTokens,
    notConfirmedDuplicateTokens: eligible.tokens - duplicateClassification.confirmed.tokens,
    payloadUniverseEventInvariant: observed.events === eligible.events + observed.events - eligible.events,
    payloadUniverseTokenInvariant: observed.tokens === eligible.tokens + observed.tokens - eligible.tokens,
    payloadTokenInvariant: eligible.tokens === classifiedTokens,
    payloadEventInvariant: eligible.events === classifiedEvents,
    payloadClassificationInvariant: eligible.tokens === classifiedTokens,
  };
}
