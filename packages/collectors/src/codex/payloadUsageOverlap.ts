import { totalTokens, type TokenUsage } from "@lw-aiusage/core";
import { objectValue, stableEventId, stableHash, stringValue } from "../shared/identity";
import {
  counterDecrease,
  normalizeRawCounters,
  positiveRawDelta,
  rawCountersFrom,
  sameRawCounters,
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
  payloadTokens: number;
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

interface OverlapCount {
  events: number;
  tokens: number;
}

export interface PayloadOverlapModel {
  model: string;
  payloadEvents: number;
  payloadTokens: number;
  confirmedDuplicateTokens: number;
  probableDuplicateTokens: number;
  unmatchedTokens: number;
}

export interface PayloadUsageOverlapReport {
  payloadEvents: number;
  payloadTokens: number;
  tokenCountEvents: number;
  tokenCountTokens: number;
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
  uniqueOrUnresolvedPayloadTokens: number;
  payloadTokenInvariant: boolean;
  payloadEventInvariant: boolean;
  payloadClassificationInvariant: boolean;
}

const evidenceValues: PayloadLinkEvidence[] = [
  "same-response-id",
  "same-turn-id",
  "exact-usage-near-time",
  "exact-usage-wide-time",
  "same-total-near-time",
  "none",
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
  return {
    lastNode,
    totalNode,
    last: rawCountersWithPresence(lastNode),
    total: rawCountersWithPresence(totalNode),
  };
};

const refOf = (
  file: CodexExtractedFile,
  event: CodexExtractedEvent,
  source: "token-count" | "payload-usage",
  rawNode: unknown,
  rawCounters: CodexRawCounters | undefined,
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
  return {
    stableId,
    sessionId,
    timestamp: timestampOf(event),
    turnId,
    responseId,
    model: event.resolvedModel,
    semanticType: event.semanticType,
    source,
    usage: normalizeRawCounters(rawCounters),
    rawCounters: cloneRaw(rawCounters),
    hasTokenContribution: source === "payload-usage" || totalTokens(normalizeRawCounters(rawCounters)) > 0,
  };
};

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
      const rawNode = nodes.lastNode ?? nodes.totalNode;
      const ref = refOf(file, event, "token-count", rawNode, contribution);
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
      const payloadRef = refOf(file, event, "payload-usage", payloadNode, rawCountersWithPresence(payloadNode));
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
const within = (left: CodexUsageEventRef, right: CodexUsageEventRef, limit: number): boolean => {
  const delta = timeDelta(left, right);
  return delta !== undefined && delta <= limit;
};

function duplicateClassOf(
  evidence: PayloadLinkEvidence,
  confidence: PayloadLinkConfidence,
  relation: PayloadUsageRelation,
): PayloadDuplicateClass {
  if (confidence === "ambiguous") return "ambiguous";
  if (confidence === "unmatched") return "unmatched";
  if (confidence === "weak") return "weak-candidate";
  if (relation !== "same-components") return "linked-different-usage";
  if (evidence === "same-response-id" && confidence === "exact") return "confirmed";
  if (confidence === "probable") return "probable";
  if (confidence === "possible") return "possible";
  return "linked-different-usage";
}

const dayOf = (timestamp?: number): string | undefined => {
  if (timestamp === undefined) return undefined;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export function auditCodexPayloadUsageOverlap(
  files: readonly CodexExtractedFile[],
): PayloadUsageOverlapReport {
  const refs = collectCodexUsageEventRefs(files);
  const tokenUsed = new Set<number>();
  const matches = new Map<number, PayloadUsageMatch>();
  const candidates = (payload: CodexUsageEventRef, predicate: (token: CodexUsageEventRef) => boolean): number[] =>
    refs.tokenCount
      .map((token, index) => ({ token, index }))
      .filter(({ token, index }) => !tokenUsed.has(index) && token.sessionId === payload.sessionId && predicate(token))
      .map(({ index }) => index);
  const selectUnique = (payload: CodexUsageEventRef, values: number[]): number | undefined => {
    if (values.length !== 1) return undefined;
    return values[0];
  };
  const addMatch = (
    payloadIndex: number,
    payload: CodexUsageEventRef,
    tokenIndex: number | undefined,
    evidence: PayloadLinkEvidence,
    confidence: PayloadLinkConfidence,
  ): void => {
    const token = tokenIndex === undefined ? undefined : refs.tokenCount[tokenIndex];
    const relation = usageRelation(payload.usage, token?.usage);
    matches.set(payloadIndex, {
      payload,
      tokenCount: token,
      evidence,
      linkConfidence: confidence,
      usageRelation: relation,
      duplicateClass: duplicateClassOf(evidence, confidence, relation),
      timeDeltaMs: token ? timeDelta(payload, token) : undefined,
    });
    if (tokenIndex !== undefined) tokenUsed.add(tokenIndex);
  };
  for (const [payloadIndex, payload] of refs.payloadUsage.entries()) {
    const responseCandidates = payload.responseId
      ? candidates(payload, (token) => token.responseId === payload.responseId)
      : [];
    if (responseCandidates.length > 1) {
      addMatch(payloadIndex, payload, undefined, "same-response-id", "ambiguous");
      continue;
    }
    if (responseCandidates.length === 1) {
      addMatch(payloadIndex, payload, responseCandidates[0], "same-response-id", "exact");
      continue;
    }
    const turnCandidates = payload.turnId
      ? candidates(payload, (token) => token.turnId === payload.turnId)
      : [];
    if (turnCandidates.length > 1) {
      addMatch(payloadIndex, payload, undefined, "same-turn-id", "ambiguous");
      continue;
    }
    if (turnCandidates.length === 1) {
      addMatch(payloadIndex, payload, turnCandidates[0], "same-turn-id", "probable");
      continue;
    }
    const nearCandidates = candidates(payload, (token) => token.hasTokenContribution && sameUsageExact(payload.usage, token.usage) && within(payload, token, 1_000));
    if (nearCandidates.length > 1) {
      addMatch(payloadIndex, payload, undefined, "exact-usage-near-time", "ambiguous");
      continue;
    }
    const nearIndex = selectUnique(payload, nearCandidates);
    if (nearIndex !== undefined) {
      addMatch(payloadIndex, payload, nearIndex, "exact-usage-near-time", "probable");
      continue;
    }
    const wideCandidates = candidates(payload, (token) => token.hasTokenContribution && sameUsageExact(payload.usage, token.usage) && within(payload, token, 10_000));
    if (wideCandidates.length > 1) {
      addMatch(payloadIndex, payload, undefined, "exact-usage-wide-time", "ambiguous");
      continue;
    }
    const wideIndex = selectUnique(payload, wideCandidates);
    if (wideIndex !== undefined) {
      addMatch(payloadIndex, payload, wideIndex, "exact-usage-wide-time", "possible");
      continue;
    }
    const weakCandidates = candidates(payload, (token) => token.hasTokenContribution && totalTokens(payload.usage) === totalTokens(token.usage) && within(payload, token, 10_000));
    if (weakCandidates.length > 1) {
      addMatch(payloadIndex, payload, undefined, "same-total-near-time", "ambiguous");
      continue;
    }
    const weakIndex = selectUnique(payload, weakCandidates);
    addMatch(payloadIndex, payload, weakIndex, weakIndex === undefined ? "none" : "same-total-near-time", weakIndex === undefined ? "unmatched" : "weak");
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
  const samples: PayloadOverlapSample[] = [];
  for (let index = 0; index < refs.payloadUsage.length; index += 1) {
    const payload = refs.payloadUsage[index]!;
    const match = matches.get(index) ?? {
      payload,
      evidence: "none" as const,
      linkConfidence: "unmatched" as const,
      usageRelation: "unknown" as const,
      duplicateClass: "unmatched" as const,
    };
    const tokens = totalTokens(payload.usage);
    const duplicateKey = (match.duplicateClass === "linked-different-usage"
      ? "linkedDifferentUsage"
      : match.duplicateClass === "weak-candidate"
        ? "weakCandidate"
        : match.duplicateClass) as keyof typeof duplicateClassification;
    const duplicateCount = duplicateClassification[duplicateKey];
    duplicateCount.events += 1;
    duplicateCount.tokens += tokens;
    const linkCount = linkSummary[match.linkConfidence];
    linkCount.events += 1;
    linkCount.tokens += tokens;
    byEvidence[match.evidence].events += 1;
    byEvidence[match.evidence].tokens += tokens;
    const semantic = payload.semanticType ?? "unknown";
    const semanticCount = bySemanticType[semantic] ?? emptyCount();
    semanticCount.events += 1;
    semanticCount.tokens += tokens;
    bySemanticType[semantic] = semanticCount;
    const model = payload.model ?? "unknown";
    const modelCount = byModel.get(model) ?? { model, payloadEvents: 0, payloadTokens: 0, confirmedDuplicateTokens: 0, probableDuplicateTokens: 0, unmatchedTokens: 0 };
    modelCount.payloadEvents += 1;
    modelCount.payloadTokens += tokens;
    if (match.duplicateClass === "confirmed") modelCount.confirmedDuplicateTokens += tokens;
    if (match.duplicateClass === "probable") modelCount.probableDuplicateTokens += tokens;
    if (match.duplicateClass === "unmatched") modelCount.unmatchedTokens += tokens;
    byModel.set(model, modelCount);
    const day = dayOf(payload.timestamp);
    if (day) {
      const daySummary = days.get(day) ?? { day, tokenCountTokens: 0, payloadTokens: 0, confirmedDuplicateTokens: 0, probableDuplicateTokens: 0, possibleDuplicateTokens: 0, linkedDifferentUsageTokens: 0, weakCandidateTokens: 0, ambiguousTokens: 0, unmatchedTokens: 0 };
      daySummary.payloadTokens += tokens;
      const field = dayFieldOf[match.duplicateClass];
      const dayValues = daySummary as unknown as Record<string, number>;
      dayValues[field] = (dayValues[field] ?? 0) + tokens;
      days.set(day, daySummary);
    }
    if (samples.length < 20) samples.push({
      sessionHash: stableHash(payload.sessionId),
      payloadRecordHash: stableHash(payload.stableId),
      tokenCountRecordHash: match.tokenCount ? stableHash(match.tokenCount.stableId) : undefined,
      evidence: match.evidence,
      linkConfidence: match.linkConfidence,
      usageRelation: match.usageRelation,
      duplicateClass: match.duplicateClass,
      timeDeltaMs: match.timeDeltaMs,
      payloadTokens: tokens,
      tokenCountTokens: match.tokenCount ? totalTokens(match.tokenCount.usage) : undefined,
    });
  }
  for (const token of refs.tokenCount) {
    const day = dayOf(token.timestamp);
    if (!day) continue;
    const daySummary = days.get(day) ?? { day, tokenCountTokens: 0, payloadTokens: 0, confirmedDuplicateTokens: 0, probableDuplicateTokens: 0, possibleDuplicateTokens: 0, linkedDifferentUsageTokens: 0, weakCandidateTokens: 0, ambiguousTokens: 0, unmatchedTokens: 0 };
    daySummary.tokenCountTokens += totalTokens(token.usage);
    days.set(day, daySummary);
  }
  const payloadTokens = refs.payloadUsage.reduce((sum, ref) => sum + totalTokens(ref.usage), 0);
  const classifiedTokens = Object.values(duplicateClassification).reduce((sum, count) => sum + count.tokens, 0);
  const classifiedEvents = Object.values(duplicateClassification).reduce((sum, count) => sum + count.events, 0);
  const linkedTokens = Object.entries(linkSummary)
    .filter(([confidence]) => confidence !== "unmatched")
    .reduce((sum, [, count]) => sum + count.tokens, 0);
  const confirmedDuplicateTokens = duplicateClassification.confirmed.tokens;
  return {
    payloadEvents: refs.payloadUsage.length,
    payloadTokens,
    tokenCountEvents: refs.tokenCount.length,
    tokenCountTokens: refs.tokenCount.reduce((sum, ref) => sum + totalTokens(ref.usage), 0),
    duplicateClassification,
    linkSummary,
    byEvidence,
    bySemanticType,
    byModel: [...byModel.values()].sort((left, right) => right.payloadTokens - left.payloadTokens),
    peakDays: [...days.values()].sort((left, right) => right.payloadTokens - left.payloadTokens).slice(0, 20),
    samples,
    confirmedDuplicateTokens,
    linkedTokens,
    uniqueOrUnresolvedPayloadTokens: payloadTokens - confirmedDuplicateTokens,
    payloadTokenInvariant: payloadTokens === classifiedTokens,
    payloadEventInvariant: classifiedEvents === refs.payloadUsage.length,
    payloadClassificationInvariant: classifiedTokens === payloadTokens,
  };
}
