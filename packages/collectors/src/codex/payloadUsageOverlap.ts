import { totalTokens, type TokenUsage } from "@lw-aiusage/core";
import { objectValue, stableEventId, stableHash, stringValue } from "../shared/identity";
import { normalizeRawCounters, rawCountersFrom, type CodexRawCounters } from "./accounting";
import { canonicalizeMirrorFiles } from "./mirrorFileReconcile";
import type { CodexExtractedEvent, CodexExtractedFile } from "./rawAuditTypes";

export type PayloadOverlapEvidence =
  | "same-response-id"
  | "same-response-different-usage"
  | "same-turn-id"
  | "exact-usage-near-time"
  | "exact-usage-wide-time"
  | "same-total-near-time"
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
}

export interface PayloadOverlapDay {
  day: string;
  payloadTokens: number;
  matchedTokens: number;
  unmatchedTokens: number;
  tokenCountTokens: number;
}

export interface PayloadOverlapSample {
  sessionHash: string;
  payloadRecordHash: string;
  tokenCountRecordHash?: string;
  evidence: PayloadOverlapEvidence;
  timeDeltaMs?: number;
  payloadTokens: number;
  tokenCountTokens?: number;
  sameUsage: boolean;
}

interface OverlapCount {
  events: number;
  tokens: number;
}

export interface PayloadUsageOverlapReport {
  payloadEvents: number;
  payloadTokens: number;
  tokenCountEvents: number;
  tokenCountTokens: number;
  exact: OverlapCount;
  probable: OverlapCount;
  possible: OverlapCount;
  ambiguous: OverlapCount;
  unmatched: OverlapCount;
  byEvidence: Record<PayloadOverlapEvidence, OverlapCount>;
  bySemanticType: Record<string, OverlapCount>;
  byModel: Array<{ model: string; events: number; tokens: number }>;
  peakDays: PayloadOverlapDay[];
  samples: PayloadOverlapSample[];
  payloadTokenInvariant: boolean;
}

const evidenceValues: PayloadOverlapEvidence[] = [
  "same-response-id",
  "same-response-different-usage",
  "same-turn-id",
  "exact-usage-near-time",
  "exact-usage-wide-time",
  "same-total-near-time",
  "ambiguous",
  "unmatched",
];

const cloneUsage = (usage: TokenUsage): TokenUsage => ({ ...usage });
const sameUsage = (left: TokenUsage, right: TokenUsage): boolean =>
  left.inputTokens === right.inputTokens &&
  left.cachedInputTokens === right.cachedInputTokens &&
  left.cacheCreationInputTokens === right.cacheCreationInputTokens &&
  left.outputTokens === right.outputTokens &&
  left.reasoningOutputTokens === right.reasoningOutputTokens;

const emptyCount = (): OverlapCount => ({ events: 0, tokens: 0 });
const emptyEvidence = (): Record<PayloadOverlapEvidence, OverlapCount> =>
  Object.fromEntries(evidenceValues.map((value) => [value, emptyCount()])) as Record<PayloadOverlapEvidence, OverlapCount>;

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

const usageNodeOf = (event: CodexExtractedEvent): { node?: unknown; raw?: CodexRawCounters } => {
  const payload = payloadOf(event);
  const msg = objectValue(payload.msg);
  const info = objectValue(payload.info) ?? objectValue(msg?.info) ?? objectValue(event.raw.info);
  const lastNode = info?.last_token_usage ?? info?.lastTokenUsage;
  const totalNode = info?.total_token_usage ?? info?.totalTokenUsage;
  const node = lastNode ?? totalNode;
  return { node, raw: rawCountersFrom(node) };
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
  const sessionId = event.resolvedSessionId ?? file.finalSessionId ?? `file:${file.entry.path}`;
  const responseId = stringValue(payload.response_id) ?? stringValue(payload.responseId);
  const turnId = stringValue(payload.turn_id) ?? stringValue(payload.turnId);
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
    rawCounters,
  };
};

export function collectCodexUsageEventRefs(files: readonly CodexExtractedFile[]): {
  tokenCount: CodexUsageEventRef[];
  payloadUsage: CodexUsageEventRef[];
} {
  const tokenCount: CodexUsageEventRef[] = [];
  const payloadUsage: CodexUsageEventRef[] = [];
  for (const file of canonicalizeMirrorFiles(files)) {
    for (const event of file.events) {
      const payload = payloadOf(event);
      const tokenNode = usageNodeOf(event);
      if (event.isTokenCount) {
        const ref = refOf(file, event, "token-count", tokenNode.node, tokenNode.raw);
        if (ref) tokenCount.push(ref);
      }
      const payloadNode = objectValue(payload.usage);
      const payloadRaw = rawCountersFrom(payloadNode);
      const payloadRef = refOf(file, event, "payload-usage", payloadNode, payloadRaw);
      if (payloadRef) payloadUsage.push(payloadRef);
    }
  }
  return { tokenCount, payloadUsage };
}

const dayOf = (timestamp?: number): string | undefined => {
  if (timestamp === undefined) return undefined;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const categoryOf = (evidence: PayloadOverlapEvidence): "exact" | "probable" | "possible" | "ambiguous" | "unmatched" => {
  if (evidence === "same-response-id" || evidence === "same-response-different-usage" || evidence === "same-turn-id") return "exact";
  if (evidence === "exact-usage-near-time") return "probable";
  if (evidence === "exact-usage-wide-time") return "possible";
  if (evidence === "ambiguous") return "ambiguous";
  return "unmatched";
};

export function auditCodexPayloadUsageOverlap(
  files: readonly CodexExtractedFile[],
): PayloadUsageOverlapReport {
  const refs = collectCodexUsageEventRefs(files);
  const byEvidence = emptyEvidence();
  const tokenUsed = new Set<number>();
  const classified = new Map<number, { evidence: PayloadOverlapEvidence; token?: CodexUsageEventRef; timeDeltaMs?: number }>();
  const exactCandidates = (payload: CodexUsageEventRef, predicate: (token: CodexUsageEventRef) => boolean): number[] =>
    refs.tokenCount.map((token, index) => ({ token, index })).filter(({ token, index }) => !tokenUsed.has(index) && token.sessionId === payload.sessionId && predicate(token)).map(({ index }) => index);
  const chooseClosest = (payload: CodexUsageEventRef, candidates: number[]): number | undefined => {
    if (candidates.length === 0) return undefined;
    const withDistance = candidates.map((index) => ({ index, distance: payload.timestamp === undefined || refs.tokenCount[index]!.timestamp === undefined ? Number.POSITIVE_INFINITY : Math.abs(payload.timestamp - refs.tokenCount[index]!.timestamp!) }));
    const minimum = Math.min(...withDistance.map((item) => item.distance));
    const closest = withDistance.filter((item) => item.distance === minimum);
    return closest.length === 1 ? closest[0]!.index : undefined;
  };
  for (const [payloadIndex, payload] of refs.payloadUsage.entries()) {
    const responseCandidates = payload.responseId
      ? exactCandidates(payload, (token) => token.responseId === payload.responseId)
      : [];
    if (responseCandidates.length > 1) {
      classified.set(payloadIndex, { evidence: "ambiguous" });
      continue;
    }
    if (responseCandidates.length === 1) {
      const index = responseCandidates[0]!;
      tokenUsed.add(index);
      classified.set(payloadIndex, { evidence: sameUsage(payload.usage, refs.tokenCount[index]!.usage) ? "same-response-id" : "same-response-different-usage", token: refs.tokenCount[index], timeDeltaMs: timeDelta(payload, refs.tokenCount[index]!) });
      continue;
    }
    const turnCandidates = payload.turnId
      ? exactCandidates(payload, (token) => token.turnId === payload.turnId)
      : [];
    if (turnCandidates.length > 1) {
      classified.set(payloadIndex, { evidence: "ambiguous" });
      continue;
    }
    if (turnCandidates.length === 1) {
      const index = turnCandidates[0]!;
      tokenUsed.add(index);
      classified.set(payloadIndex, { evidence: "same-turn-id", token: refs.tokenCount[index]!, timeDeltaMs: timeDelta(payload, refs.tokenCount[index]!) });
      continue;
    }
    const nearUsageCandidates = exactCandidates(payload, (token) => sameUsage(payload.usage, token.usage) && timeDeltaWithin(payload, token, 1_000));
    if (nearUsageCandidates.length > 1) {
      classified.set(payloadIndex, { evidence: "ambiguous" });
      continue;
    }
    const nearUsageIndex = chooseClosest(payload, nearUsageCandidates);
    if (nearUsageIndex !== undefined) {
      tokenUsed.add(nearUsageIndex);
      classified.set(payloadIndex, { evidence: "exact-usage-near-time", token: refs.tokenCount[nearUsageIndex]!, timeDeltaMs: timeDelta(payload, refs.tokenCount[nearUsageIndex]!) });
      continue;
    }
    const wideUsageCandidates = exactCandidates(payload, (token) => sameUsage(payload.usage, token.usage) && timeDeltaWithin(payload, token, 10_000));
    if (wideUsageCandidates.length > 1) {
      classified.set(payloadIndex, { evidence: "ambiguous" });
      continue;
    }
    const wideUsageIndex = chooseClosest(payload, wideUsageCandidates);
    if (wideUsageIndex !== undefined) {
      tokenUsed.add(wideUsageIndex);
      classified.set(payloadIndex, { evidence: "exact-usage-wide-time", token: refs.tokenCount[wideUsageIndex]!, timeDeltaMs: timeDelta(payload, refs.tokenCount[wideUsageIndex]!) });
      continue;
    }
    const weakCandidates = exactCandidates(payload, (token) => totalTokens(payload.usage) === totalTokens(token.usage) && timeDeltaWithin(payload, token, 10_000));
    classified.set(payloadIndex, { evidence: weakCandidates.length > 0 ? "same-total-near-time" : "unmatched" });
  }

  const bySemanticType: Record<string, OverlapCount> = {};
  const byModel = new Map<string, OverlapCount>();
  const days = new Map<string, PayloadOverlapDay>();
  const buckets = { exact: emptyCount(), probable: emptyCount(), possible: emptyCount(), ambiguous: emptyCount(), unmatched: emptyCount() };
  const samples: PayloadOverlapSample[] = [];
  for (const [index, payload] of refs.payloadUsage.entries()) {
    const classification = classified.get(index) ?? { evidence: "unmatched" as const };
    const category = categoryOf(classification.evidence);
    const tokens = totalTokens(payload.usage);
    buckets[category].events += 1;
    buckets[category].tokens += tokens;
    byEvidence[classification.evidence].events += 1;
    byEvidence[classification.evidence].tokens += tokens;
    const semantic = payload.semanticType ?? "unknown";
    const semanticCount = bySemanticType[semantic] ?? emptyCount();
    semanticCount.events += 1;
    semanticCount.tokens += tokens;
    bySemanticType[semantic] = semanticCount;
    const model = payload.model ?? "unknown";
    const modelCount = byModel.get(model) ?? emptyCount();
    modelCount.events += 1;
    modelCount.tokens += tokens;
    byModel.set(model, modelCount);
    const day = dayOf(payload.timestamp);
    if (day) {
      const daySummary = days.get(day) ?? { day, payloadTokens: 0, matchedTokens: 0, unmatchedTokens: 0, tokenCountTokens: 0 };
      daySummary.payloadTokens += tokens;
      if (category === "exact" || category === "probable" || category === "possible") daySummary.matchedTokens += tokens;
      else daySummary.unmatchedTokens += tokens;
      days.set(day, daySummary);
    }
    if (samples.length < 20) samples.push({ sessionHash: stableHash(payload.sessionId), payloadRecordHash: stableHash(payload.stableId), tokenCountRecordHash: classification.token ? stableHash(classification.token.stableId) : undefined, evidence: classification.evidence, timeDeltaMs: classification.timeDeltaMs, payloadTokens: tokens, tokenCountTokens: classification.token ? totalTokens(classification.token.usage) : undefined, sameUsage: classification.token ? sameUsage(payload.usage, classification.token.usage) : false });
  }
  for (const token of refs.tokenCount) {
    const day = dayOf(token.timestamp);
    if (!day) continue;
    const daySummary = days.get(day) ?? { day, payloadTokens: 0, matchedTokens: 0, unmatchedTokens: 0, tokenCountTokens: 0 };
    daySummary.tokenCountTokens += totalTokens(token.usage);
    days.set(day, daySummary);
  }
  const payloadTokens = refs.payloadUsage.reduce((sum, ref) => sum + totalTokens(ref.usage), 0);
  const classifiedTokens = Object.values(buckets).reduce((sum, bucket) => sum + bucket.tokens, 0);
  return {
    payloadEvents: refs.payloadUsage.length,
    payloadTokens,
    tokenCountEvents: refs.tokenCount.length,
    tokenCountTokens: refs.tokenCount.reduce((sum, ref) => sum + totalTokens(ref.usage), 0),
    ...buckets,
    byEvidence,
    bySemanticType,
    byModel: [...byModel.entries()].map(([model, count]) => ({ model, ...count })).sort((left, right) => right.tokens - left.tokens),
    peakDays: [...days.values()].sort((left, right) => right.payloadTokens - left.payloadTokens).slice(0, 20),
    samples,
    payloadTokenInvariant: payloadTokens === classifiedTokens,
  };
}

function timeDelta(left: CodexUsageEventRef, right: CodexUsageEventRef): number | undefined {
  return left.timestamp === undefined || right.timestamp === undefined ? undefined : Math.abs(left.timestamp - right.timestamp);
}

function timeDeltaWithin(left: CodexUsageEventRef, right: CodexUsageEventRef, limit: number): boolean {
  const distance = timeDelta(left, right);
  return distance !== undefined && distance <= limit;
}
