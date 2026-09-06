import { totalTokens, type TokenUsage } from "@lw-aiusage/core";
import {
  effectiveAggregateTotal,
  normalizeRawTokenUsage,
  type AccountingContribution,
  type CodexAccountingEvent,
  type RawTokenUsage,
  type TokenCountAccountingMethod,
} from "./accountingV5";

export type UsagePrecision = "components-exact" | "aggregate-only" | "partial";

export interface CanonicalTokenCountRef {
  event: CodexAccountingEvent;
  usage: TokenUsage;
  method: TokenCountAccountingMethod;
  precision: UsagePrecision;
}

export interface PayloadUsageCandidate {
  event: CodexAccountingEvent;
  usage: TokenUsage;
  precision: UsagePrecision;
  aggregateTotal: number;
  componentConsistencyMismatch: boolean;
}

export type PayloadDisposition =
  | "suppress-confirmed"
  | "fallback-unmatched"
  | "fallback-conflict"
  | "fallback-ambiguous"
  | "ignore-zero";

export type PayloadDuplicateEvidence =
  | "same-raw-event-components"
  | "same-raw-event-aggregate"
  | "same-response-id-components";

export type PayloadResolutionReason =
  | "no-response-id"
  | "no-token-candidate"
  | "different-components"
  | "same-total-different-components"
  | "model-conflict"
  | "multiple-candidates";

export interface PayloadResolution {
  payload: PayloadUsageCandidate;
  disposition: PayloadDisposition;
  evidence?: PayloadDuplicateEvidence;
  matchedToken?: CanonicalTokenCountRef;
  reason?: PayloadResolutionReason;
}

export interface PayloadFallbackContribution {
  event: CodexAccountingEvent;
  usage: TokenUsage;
  sourceKind: "payload-fallback";
  precision: UsagePrecision;
  reason: Exclude<PayloadDisposition, "suppress-confirmed" | "ignore-zero">;
}

export interface PayloadSuppression {
  payload: PayloadUsageCandidate;
  token: CanonicalTokenCountRef;
  evidence: PayloadDuplicateEvidence;
  suppressedTokens: number;
}

export interface PayloadFallbackDiagnostics {
  observedPayloadEvents: number;
  observedPayloadTokens: number;
  exactRawDuplicateEvents: number;
  exactRawDuplicateTokens: number;
  confirmedSuppressedEvents: number;
  confirmedSuppressedTokens: number;
  sameRawEventSuppressedEvents: number;
  sameResponseSuppressedEvents: number;
  fallbackEvents: number;
  fallbackTokens: number;
  conflictEvents: number;
  ambiguousEvents: number;
  unmatchedEvents: number;
  zeroEvents: number;
  componentConsistencyMismatchEvents: number;
  sameResponseDifferentUsageEvents: number;
  sameResponseSameTotalDifferentComponentsEvents: number;
  modelConflictEvents: number;
}

export interface PayloadFallbackInput {
  tokenCounts: readonly CanonicalTokenCountRef[];
  payloads: readonly PayloadUsageCandidate[];
}

export interface PayloadDedupResult {
  candidates: PayloadUsageCandidate[];
  exactDuplicateCount: number;
  exactDuplicateTokens: number;
}

export interface PayloadFallbackResult {
  suppressed: PayloadSuppression[];
  fallbacks: PayloadFallbackContribution[];
  resolutions: PayloadResolution[];
  diagnostics: PayloadFallbackDiagnostics;
  payloadEventInvariant: boolean;
  payloadTokenInvariant: boolean;
}

const aggregateUsage = (tokens: number): TokenUsage => ({
  inputTokens: Math.max(tokens, 0),
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
});

const sameUsageComponents = (left: TokenUsage, right: TokenUsage): boolean =>
  left.inputTokens === right.inputTokens &&
  left.cachedInputTokens === right.cachedInputTokens &&
  left.cacheCreationInputTokens === right.cacheCreationInputTokens &&
  left.outputTokens === right.outputTokens &&
  left.reasoningOutputTokens === right.reasoningOutputTokens;

const sameUsageTotal = (left: TokenUsage, right: TokenUsage): boolean => totalTokens(left) === totalTokens(right);

export function eventScope(event: CodexAccountingEvent): string {
  return event.sessionId ?? event.sourcePath;
}

const rawEventKey = (event: CodexAccountingEvent): string => `${eventScope(event)}\n${event.rawIdentity}`;

const compareAccountingEvent = (left: CodexAccountingEvent, right: CodexAccountingEvent): number => {
  const leftTimestamp = left.timestamp ?? Number.MAX_SAFE_INTEGER;
  const rightTimestamp = right.timestamp ?? Number.MAX_SAFE_INTEGER;
  return eventScope(left).localeCompare(eventScope(right)) ||
    leftTimestamp - rightTimestamp ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.eventIndex - right.eventIndex ||
    left.rawIdentity.localeCompare(right.rawIdentity);
};

export function deduplicatePayloadCandidates(
  payloads: readonly PayloadUsageCandidate[],
): PayloadDedupResult {
  const candidates: PayloadUsageCandidate[] = [];
  const seenKeys = new Set<string>();
  let exactDuplicateCount = 0;
  let exactDuplicateTokens = 0;
  for (const payload of [...payloads].sort((left, right) => compareAccountingEvent(left.event, right.event))) {
    if (seenKeys.has(rawEventKey(payload.event))) {
      exactDuplicateCount += 1;
      exactDuplicateTokens += totalTokens(payload.usage);
      continue;
    }
    seenKeys.add(rawEventKey(payload.event));
    candidates.push(payload);
  }
  return { candidates, exactDuplicateCount, exactDuplicateTokens };
}

const hasPrimaryComponents = (raw: RawTokenUsage): boolean => raw.fieldPresence.input && raw.fieldPresence.output;

export function tokenCountUsagePrecision(
  event: CodexAccountingEvent,
  contribution: AccountingContribution,
): UsagePrecision {
  if (contribution.method === "total-delta" && contribution.diagnostics.componentBreakdownExact)
    return "components-exact";
  if (contribution.method === "total-aggregate-delta") return "aggregate-only";
  if (contribution.method === "total-initial" || contribution.method === "total-reset")
    return contribution.diagnostics.componentBreakdownExact ? "components-exact" : "aggregate-only";
  if (contribution.method !== "last" || !event.tokenCount?.last) return "partial";
  const raw = event.tokenCount.last;
  if (!hasPrimaryComponents(raw)) return raw.fieldPresence.total ? "aggregate-only" : "partial";
  if (raw.fieldPresence.total && totalTokens(normalizeRawTokenUsage(raw)) !== raw.total) return "aggregate-only";
  return "components-exact";
}

export function canonicalTokenCountRefOf(
  event: CodexAccountingEvent,
  contribution: AccountingContribution,
): CanonicalTokenCountRef | undefined {
  if (totalTokens(contribution.usage) <= 0) return undefined;
  return {
    event,
    usage: contribution.usage,
    method: contribution.method,
    precision: tokenCountUsagePrecision(event, contribution),
  };
}

function resolvePayloadUsage(raw: RawTokenUsage): {
  usage: TokenUsage;
  precision: UsagePrecision;
  aggregateTotal: number;
  componentConsistencyMismatch: boolean;
} {
  const componentUsage = normalizeRawTokenUsage(raw);
  if (raw.fieldPresence.total) {
    const aggregateTotal = raw.total;
    if (hasPrimaryComponents(raw) && totalTokens(componentUsage) === aggregateTotal)
      return { usage: componentUsage, precision: "components-exact", aggregateTotal, componentConsistencyMismatch: false };
    return {
      usage: aggregateUsage(aggregateTotal),
      precision: "aggregate-only",
      aggregateTotal,
      componentConsistencyMismatch: hasPrimaryComponents(raw) && totalTokens(componentUsage) !== aggregateTotal,
    };
  }
  const aggregateTotal = effectiveAggregateTotal(raw) ?? totalTokens(componentUsage);
  return {
    usage: componentUsage,
    precision: hasPrimaryComponents(raw) ? "components-exact" : "partial",
    aggregateTotal,
    componentConsistencyMismatch: false,
  };
}

export function payloadUsageCandidateOf(event: CodexAccountingEvent): PayloadUsageCandidate | undefined {
  if (!event.payloadUsage) return undefined;
  const resolved = resolvePayloadUsage(event.payloadUsage);
  return { event, ...resolved };
}

interface RawMatch {
  payloadIndex: number;
  tokenIndex: number;
  evidence: PayloadDuplicateEvidence;
}

interface PayloadMatchState {
  payloads: readonly PayloadUsageCandidate[];
  tokens: readonly CanonicalTokenCountRef[];
  resolutions: Map<number, PayloadResolution>;
  usedPayloads: Set<number>;
  usedTokens: Set<number>;
}

const modelsCompatible = (payload: CodexAccountingEvent, token: CodexAccountingEvent): boolean =>
  !payload.model || !token.model || payload.model === token.model;

const rawMatchEvidence = (payload: PayloadUsageCandidate, token: CanonicalTokenCountRef): PayloadDuplicateEvidence | undefined => {
  if (payload.precision === "partial" || token.precision === "partial") return undefined;
  if (payload.precision === "components-exact" && token.precision === "components-exact")
    return sameUsageComponents(payload.usage, token.usage) ? "same-raw-event-components" : undefined;
  return sameUsageTotal(payload.usage, token.usage) ? "same-raw-event-aggregate" : undefined;
};

function runRawEventPass(state: PayloadMatchState): void {
  const tokenIndexesByKey = new Map<string, number[]>();
  for (const [index, token] of state.tokens.entries()) {
    const indexes = tokenIndexesByKey.get(rawEventKey(token.event)) ?? [];
    indexes.push(index);
    tokenIndexesByKey.set(rawEventKey(token.event), indexes);
  }
  const matches: RawMatch[] = [];
  const payloadCandidates = new Map<number, RawMatch[]>();
  for (const [payloadIndex, payload] of state.payloads.entries()) {
    if (state.usedPayloads.has(payloadIndex) || totalTokens(payload.usage) <= 0) continue;
    const candidates = (tokenIndexesByKey.get(rawEventKey(payload.event)) ?? [])
      .filter((tokenIndex) => !state.usedTokens.has(tokenIndex))
      .map((tokenIndex) => {
        const token = state.tokens[tokenIndex]!;
        const evidence = rawMatchEvidence(payload, token);
        return evidence && modelsCompatible(payload.event, token.event) ? { payloadIndex, tokenIndex, evidence } : undefined;
      })
      .filter((value): value is RawMatch => !!value);
    if (candidates.length) payloadCandidates.set(payloadIndex, candidates);
  }
  const tokenCandidates = new Map<number, RawMatch[]>();
  for (const candidates of payloadCandidates.values()) {
    for (const candidate of candidates) {
      matches.push(candidate);
      const reverse = tokenCandidates.get(candidate.tokenIndex) ?? [];
      reverse.push(candidate);
      tokenCandidates.set(candidate.tokenIndex, reverse);
    }
  }
  for (const candidate of matches) {
    const payloadOptions = payloadCandidates.get(candidate.payloadIndex) ?? [];
    const tokenOptions = tokenCandidates.get(candidate.tokenIndex) ?? [];
    if (payloadOptions.length !== 1 || tokenOptions.length !== 1) continue;
    const payload = state.payloads[candidate.payloadIndex]!;
    const token = state.tokens[candidate.tokenIndex]!;
    state.resolutions.set(candidate.payloadIndex, {
      payload,
      disposition: "suppress-confirmed",
      evidence: candidate.evidence,
      matchedToken: token,
    });
    state.usedPayloads.add(candidate.payloadIndex);
    state.usedTokens.add(candidate.tokenIndex);
  }
}

function responseTokensFor(
  state: PayloadMatchState,
  payload: PayloadUsageCandidate,
): { tokenIndex: number; token: CanonicalTokenCountRef }[] {
  if (!payload.event.responseId) return [];
  return state.tokens
    .map((token, tokenIndex) => ({ tokenIndex, token }))
    .filter(({ token, tokenIndex }) =>
      !state.usedTokens.has(tokenIndex) &&
      eventScope(token.event) === eventScope(payload.event) &&
      token.event.responseId === payload.event.responseId);
}

function runResponsePass(state: PayloadMatchState): void {
  const payloadCandidates = new Map<number, number[]>();
  const tokenCandidates = new Map<number, number[]>();
  for (const [payloadIndex, payload] of state.payloads.entries()) {
    if (state.usedPayloads.has(payloadIndex) || payload.precision !== "components-exact") continue;
    const candidates = responseTokensFor(state, payload)
      .filter(({ token }) => token.precision === "components-exact" && modelsCompatible(payload.event, token.event) && sameUsageComponents(payload.usage, token.usage))
      .map(({ tokenIndex }) => tokenIndex);
    if (candidates.length) payloadCandidates.set(payloadIndex, candidates);
  }
  for (const [payloadIndex, tokenIndexes] of payloadCandidates) {
    for (const tokenIndex of tokenIndexes) {
      const reverse = tokenCandidates.get(tokenIndex) ?? [];
      reverse.push(payloadIndex);
      tokenCandidates.set(tokenIndex, reverse);
    }
  }
  for (const [payloadIndex, tokenIndexes] of payloadCandidates) {
    if (tokenIndexes.length !== 1 || (tokenCandidates.get(tokenIndexes[0]!) ?? []).length !== 1) continue;
    const payload = state.payloads[payloadIndex]!;
    const token = state.tokens[tokenIndexes[0]!]!;
    state.resolutions.set(payloadIndex, {
      payload,
      disposition: "suppress-confirmed",
      evidence: "same-response-id-components",
      matchedToken: token,
    });
    state.usedPayloads.add(payloadIndex);
    state.usedTokens.add(tokenIndexes[0]!);
  }
}

function unresolvedResolution(state: PayloadMatchState, payloadIndex: number): PayloadResolution {
  const payload = state.payloads[payloadIndex]!;
  if (!payload.event.responseId)
    return { payload, disposition: "fallback-unmatched", reason: "no-response-id" };
  const responseTokens = responseTokensFor(state, payload);
  if (!responseTokens.length) return { payload, disposition: "fallback-unmatched", reason: "no-token-candidate" };
  const modelConflict = responseTokens.some(({ token }) => !modelsCompatible(payload.event, token.event));
  if (modelConflict) return { payload, disposition: "fallback-conflict", reason: "model-conflict" };
  const sameComponents = responseTokens.filter(({ token }) => token.precision === "components-exact" && sameUsageComponents(payload.usage, token.usage));
  if (sameComponents.length > 1) return { payload, disposition: "fallback-ambiguous", reason: "multiple-candidates" };
  if (sameComponents.length === 1) return { payload, disposition: "fallback-ambiguous", reason: "multiple-candidates" };
  if (responseTokens.some(({ token }) => sameUsageTotal(payload.usage, token.usage)))
    return { payload, disposition: "fallback-conflict", reason: "same-total-different-components" };
  return { payload, disposition: "fallback-conflict", reason: "different-components" };
}

const emptyDiagnostics = (): PayloadFallbackDiagnostics => ({
  observedPayloadEvents: 0,
  observedPayloadTokens: 0,
  exactRawDuplicateEvents: 0,
  exactRawDuplicateTokens: 0,
  confirmedSuppressedEvents: 0,
  confirmedSuppressedTokens: 0,
  sameRawEventSuppressedEvents: 0,
  sameResponseSuppressedEvents: 0,
  fallbackEvents: 0,
  fallbackTokens: 0,
  conflictEvents: 0,
  ambiguousEvents: 0,
  unmatchedEvents: 0,
  zeroEvents: 0,
  componentConsistencyMismatchEvents: 0,
  sameResponseDifferentUsageEvents: 0,
  sameResponseSameTotalDifferentComponentsEvents: 0,
  modelConflictEvents: 0,
});

export function resolvePayloadFallbackV5(
  tokenCounts: readonly CanonicalTokenCountRef[],
  payloads: readonly PayloadUsageCandidate[],
): PayloadFallbackResult {
  const orderedPayloads = [...payloads].sort((left, right) => compareAccountingEvent(left.event, right.event));
  const orderedTokens = [...tokenCounts].sort((left, right) => compareAccountingEvent(left.event, right.event));
  const dedupedPayloads = deduplicatePayloadCandidates(orderedPayloads);
  const diagnostics = emptyDiagnostics();
  diagnostics.observedPayloadEvents = payloads.length;
  diagnostics.observedPayloadTokens = payloads.reduce((sum, payload) => sum + totalTokens(payload.usage), 0);
  diagnostics.exactRawDuplicateEvents = dedupedPayloads.exactDuplicateCount;
  diagnostics.exactRawDuplicateTokens = dedupedPayloads.exactDuplicateTokens;

  const state: PayloadMatchState = {
    payloads: dedupedPayloads.candidates,
    tokens: orderedTokens,
    resolutions: new Map(),
    usedPayloads: new Set(),
    usedTokens: new Set(),
  };
  runRawEventPass(state);
  runResponsePass(state);

  for (const [payloadIndex, payload] of state.payloads.entries()) {
    if (state.resolutions.has(payloadIndex)) continue;
    const resolution = totalTokens(payload.usage) <= 0
      ? { payload, disposition: "ignore-zero" as const }
      : unresolvedResolution(state, payloadIndex);
    state.resolutions.set(payloadIndex, resolution);
  }

  const resolutions = [...state.resolutions.values()].sort((left, right) => compareAccountingEvent(left.payload.event, right.payload.event));
  const suppressed: PayloadSuppression[] = [];
  const fallbacks: PayloadFallbackContribution[] = [];
  for (const resolution of resolutions) {
    const payloadTokens = totalTokens(resolution.payload.usage);
    if (resolution.payload.componentConsistencyMismatch) diagnostics.componentConsistencyMismatchEvents += 1;
    if (resolution.disposition === "suppress-confirmed" && resolution.matchedToken && resolution.evidence) {
      suppressed.push({ payload: resolution.payload, token: resolution.matchedToken, evidence: resolution.evidence, suppressedTokens: payloadTokens });
      diagnostics.confirmedSuppressedEvents += 1;
      diagnostics.confirmedSuppressedTokens += payloadTokens;
      if (resolution.evidence.startsWith("same-raw-event")) diagnostics.sameRawEventSuppressedEvents += 1;
      if (resolution.evidence === "same-response-id-components") diagnostics.sameResponseSuppressedEvents += 1;
    } else if (resolution.disposition === "ignore-zero") {
      diagnostics.zeroEvents += 1;
    } else {
      const reason = resolution.disposition as Exclude<PayloadDisposition, "suppress-confirmed" | "ignore-zero">;
      fallbacks.push({ event: resolution.payload.event, usage: resolution.payload.usage, sourceKind: "payload-fallback", precision: resolution.payload.precision, reason });
      diagnostics.fallbackEvents += 1;
      diagnostics.fallbackTokens += payloadTokens;
      if (resolution.disposition === "fallback-conflict") diagnostics.conflictEvents += 1;
      if (resolution.disposition === "fallback-ambiguous") diagnostics.ambiguousEvents += 1;
      if (resolution.disposition === "fallback-unmatched") diagnostics.unmatchedEvents += 1;
      if (resolution.reason === "model-conflict") diagnostics.modelConflictEvents += 1;
      if (resolution.reason === "different-components") diagnostics.sameResponseDifferentUsageEvents += 1;
      if (resolution.reason === "same-total-different-components") diagnostics.sameResponseSameTotalDifferentComponentsEvents += 1;
    }
  }

  return {
    suppressed,
    fallbacks,
    resolutions,
    diagnostics,
    payloadEventInvariant: dedupedPayloads.candidates.length === suppressed.length + fallbacks.length + diagnostics.zeroEvents,
    payloadTokenInvariant: dedupedPayloads.candidates.reduce((sum, payload) => sum + totalTokens(payload.usage), 0) === diagnostics.confirmedSuppressedTokens + diagnostics.fallbackTokens,
  };
}
