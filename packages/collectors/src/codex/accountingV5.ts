import { totalTokens, zeroUsage, type TokenUsage } from "@lw-aiusage/core";
import { objectValue } from "../shared/identity";

export interface CodexAccountingEvent {
  sourcePath: string;
  eventIndex: number;
  sessionId?: string;
  parentSessionId?: string;
  timestamp?: number;
  model?: string;
  projectKey?: string;
  responseId?: string;
  turnId?: string;
  semanticType?: string;
  tokenCount?: {
    last?: RawTokenUsage;
    total?: RawTokenUsage;
  };
  payloadUsage?: RawTokenUsage;
  /**
   * Stable identity of one exact raw protocol event. It must distinguish
   * persisted events and must not be derived only from session, response,
   * turn, or timestamp metadata.
   */
  rawIdentity: string;
  /** Stable fingerprint of the complete decoded raw JSON event. */
  rawContentFingerprint?: string;
  /** Stable fingerprint with only payload.rate_limits removed. */
  semanticContentFingerprint?: string;
}

export interface RawTokenUsage {
  input: number;
  cachedInput: number;
  cacheCreationInput: number;
  output: number;
  reasoningOutput: number;
  total: number;
  fieldPresence: {
    input: boolean;
    cachedInput: boolean;
    cacheCreationInput: boolean;
    output: boolean;
    reasoningOutput: boolean;
    total: boolean;
  };
}

/** Compares a raw usage snapshot, including explicit field presence. */
export function rawTokenUsageExactEqual(
  left: RawTokenUsage | undefined,
  right: RawTokenUsage | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.input === right.input &&
    left.cachedInput === right.cachedInput &&
    left.cacheCreationInput === right.cacheCreationInput &&
    left.output === right.output &&
    left.reasoningOutput === right.reasoningOutput &&
    left.total === right.total &&
    left.fieldPresence.input === right.fieldPresence.input &&
    left.fieldPresence.cachedInput === right.fieldPresence.cachedInput &&
    left.fieldPresence.cacheCreationInput === right.fieldPresence.cacheCreationInput &&
    left.fieldPresence.output === right.fieldPresence.output &&
    left.fieldPresence.reasoningOutput === right.fieldPresence.reasoningOutput &&
    left.fieldPresence.total === right.fieldPresence.total;
}

export interface TokenCountState {
  previousTotalRaw?: RawTokenUsage;
  previousAggregateTotal?: number;
  segment: number;
}

export type RawCumulativeRelation = "initial" | "same" | "increased" | "reset" | "incomparable";
export type RawCumulativeBasis = "explicit-total" | "input-output" | "aggregate-cross-schema" | "none";

export interface RawCumulativeComparison {
  relation: RawCumulativeRelation;
  basis: RawCumulativeBasis;
  previousComparableTotal?: number;
  currentComparableTotal?: number;
  aggregateDelta?: number;
  componentCounterDecrease: boolean;
  componentBreakdownExact: boolean;
  rawDelta?: RawTokenUsage;
  componentDeltaTotal?: number;
  componentConsistencyMismatch: boolean;
  sameAggregateDifferentComponents: boolean;
}

export type TokenCountAccountingMethod =
  | "last"
  | "total-initial"
  | "total-delta"
  | "total-aggregate-delta"
  | "total-reset"
  | "duplicate-zero"
  | "unresolved";

export interface AccountingContribution {
  usage: TokenUsage;
  method: TokenCountAccountingMethod;
  nextState: TokenCountState;
  diagnostics: {
    counterReset: boolean;
    repeatedTotalWithNonZeroLast: boolean;
    comparisonBasis: RawCumulativeBasis;
    componentCounterDecrease: boolean;
    componentBreakdownExact: boolean;
    aggregateDelta?: number;
    incomparable: boolean;
    sameAggregateDifferentComponents: boolean;
    componentDeltaTotal?: number;
    componentConsistencyMismatch: boolean;
  };
}

const hasKey = (object: Record<string, unknown>, key: string): boolean => key in object;

const firstPresentNumber = (
  object: Record<string, unknown>,
  keys: readonly string[],
): { value: number; present: boolean } => {
  for (const key of keys) {
    if (!hasKey(object, key)) continue;
    const value = object[key];
    if (typeof value === "number" && Number.isFinite(value))
      return { value: Math.max(value, 0), present: true };
  }
  return { value: 0, present: false };
};

/** Decodes v5 raw counters without losing whether a field was explicitly present. */
export function decodeRawTokenUsage(value: unknown): RawTokenUsage | undefined {
  const object = objectValue(value);
  if (!object) return undefined;
  const input = firstPresentNumber(object, ["input_tokens", "inputTokens"]);
  const cachedInput = firstPresentNumber(object, ["cached_input_tokens", "cachedInputTokens"]);
  const cacheCreationInput = firstPresentNumber(object, [
    "cache_write_input_tokens",
    "cache_creation_input_tokens",
    "cacheCreationInputTokens",
  ]);
  const output = firstPresentNumber(object, ["output_tokens", "outputTokens"]);
  const reasoningOutput = firstPresentNumber(object, ["reasoning_output_tokens", "reasoningOutputTokens"]);
  const total = firstPresentNumber(object, ["total_tokens", "totalTokens"]);
  if (!input.present && !cachedInput.present && !cacheCreationInput.present && !output.present && !reasoningOutput.present && !total.present)
    return undefined;
  return {
    input: input.value,
    cachedInput: cachedInput.value,
    cacheCreationInput: cacheCreationInput.value,
    output: output.value,
    reasoningOutput: reasoningOutput.value,
    total: total.value,
    fieldPresence: {
      input: input.present,
      cachedInput: cachedInput.present,
      cacheCreationInput: cacheCreationInput.present,
      output: output.present,
      reasoningOutput: reasoningOutput.present,
      total: total.present,
    },
  };
}

/** Codex input/output counters include cached/reasoning components. */
export function normalizeRawTokenUsage(raw: RawTokenUsage): TokenUsage {
  const usage = zeroUsage();
  usage.cachedInputTokens = raw.cachedInput;
  usage.cacheCreationInputTokens = raw.cacheCreationInput;
  usage.inputTokens = Math.max(raw.input - raw.cachedInput, 0);
  usage.reasoningOutputTokens = raw.reasoningOutput;
  usage.outputTokens = Math.max(raw.output - raw.reasoningOutput, 0);
  if (raw.fieldPresence.total && raw.total > 0 && raw.input === 0 && raw.output === 0 && raw.reasoningOutput === 0 && raw.cachedInput === 0)
    usage.inputTokens = raw.total;
  return usage;
}

type RawCounterField = "input" | "cachedInput" | "cacheCreationInput" | "output" | "reasoningOutput" | "total";
const rawFieldPresent = (value: RawTokenUsage, field: RawCounterField): boolean => value.fieldPresence[field];
const secondaryCounterFields = ["cachedInput", "cacheCreationInput", "reasoningOutput"] as const;
const componentCounterFields = ["input", "cachedInput", "cacheCreationInput", "output", "reasoningOutput"] as const;

const secondaryCounterDecreased = (current: RawTokenUsage, previous: RawTokenUsage): boolean =>
  secondaryCounterFields.some((field) => rawFieldPresent(current, field) && rawFieldPresent(previous, field) && current[field] < previous[field]);

const sameComponentCounters = (current: RawTokenUsage, previous: RawTokenUsage): boolean =>
  componentCounterFields.every((field) =>
    rawFieldPresent(current, field) === rawFieldPresent(previous, field) &&
    (!rawFieldPresent(current, field) || current[field] === previous[field]));

const canDeriveExactComponentDelta = (
  current: RawTokenUsage,
  previous: RawTokenUsage,
  relation: RawCumulativeRelation,
): boolean => relation === "increased" &&
  rawFieldPresent(current, "input") && rawFieldPresent(previous, "input") &&
  rawFieldPresent(current, "output") && rawFieldPresent(previous, "output") &&
  !(current.input < previous.input || current.output < previous.output) &&
  secondaryCounterFields.every((field) => rawFieldPresent(current, field) === rawFieldPresent(previous, field)) &&
  !secondaryCounterDecreased(current, previous);

/** Returns the strongest available cumulative total without counting cached/reasoning twice. */
export function effectiveAggregateTotal(value: RawTokenUsage): number | undefined {
  if (value.fieldPresence.total) return value.total;
  if (value.fieldPresence.input && value.fieldPresence.output) return value.input + value.output;
  return undefined;
}

const deriveExactRawComponentDelta = (current: RawTokenUsage, previous: RawTokenUsage): RawTokenUsage => {
  const value = (field: RawCounterField): number => Math.max(current[field] - previous[field], 0);
  const totalPresent = rawFieldPresent(current, "total") && rawFieldPresent(previous, "total");
  return {
    input: value("input"),
    cachedInput: value("cachedInput"),
    cacheCreationInput: value("cacheCreationInput"),
    output: value("output"),
    reasoningOutput: value("reasoningOutput"),
    total: totalPresent ? value("total") : 0,
    fieldPresence: {
      input: rawFieldPresent(current, "input"),
      cachedInput: rawFieldPresent(current, "cachedInput"),
      cacheCreationInput: rawFieldPresent(current, "cacheCreationInput"),
      output: rawFieldPresent(current, "output"),
      reasoningOutput: rawFieldPresent(current, "reasoningOutput"),
      total: totalPresent,
    },
  };
};

interface ComparableCumulativePair {
  basis: RawCumulativeBasis;
  previous: number;
  current: number;
}

function resolveComparableCumulativePair(
  current: RawTokenUsage,
  state: TokenCountState,
): ComparableCumulativePair | undefined {
  const previous = state.previousTotalRaw;
  if (!previous) return undefined;
  if (current.fieldPresence.total && previous.fieldPresence.total)
    return { basis: "explicit-total", previous: previous.total, current: current.total };
  if (current.fieldPresence.input && previous.fieldPresence.input && current.fieldPresence.output && previous.fieldPresence.output)
    return { basis: "input-output", previous: previous.input + previous.output, current: current.input + current.output };
  const currentAggregate = effectiveAggregateTotal(current);
  const previousAggregate = state.previousAggregateTotal ?? effectiveAggregateTotal(previous);
  if (currentAggregate !== undefined && previousAggregate !== undefined)
    return { basis: "aggregate-cross-schema", previous: previousAggregate, current: currentAggregate };
  return undefined;
}

const hasPrimaryComponentBreakdown = (raw: RawTokenUsage): boolean => raw.fieldPresence.input && raw.fieldPresence.output;
const componentTotalOf = (raw: RawTokenUsage): number => totalTokens(normalizeRawTokenUsage(raw));
const snapshotConsistencyMismatch = (raw: RawTokenUsage, expectedAggregate: number | undefined): boolean =>
  expectedAggregate !== undefined && hasPrimaryComponentBreakdown(raw) && componentTotalOf(raw) !== expectedAggregate;

/** Compares two cumulative snapshots using one explicit, explainable basis. */
export function compareRawCumulative(
  current: RawTokenUsage,
  state: TokenCountState,
): RawCumulativeComparison {
  const previous = state.previousTotalRaw;
  const currentAggregate = effectiveAggregateTotal(current);
  const componentCounterDecrease = !!previous && secondaryCounterDecreased(current, previous);
  if (!previous) {
    return {
      relation: "initial",
      basis: current.fieldPresence.total ? "explicit-total" : current.fieldPresence.input && current.fieldPresence.output ? "input-output" : "none",
      currentComparableTotal: currentAggregate,
      componentCounterDecrease: false,
      componentBreakdownExact: false,
      componentConsistencyMismatch: snapshotConsistencyMismatch(current, currentAggregate),
      sameAggregateDifferentComponents: false,
    };
  }

  const pair = resolveComparableCumulativePair(current, state);
  if (!pair) {
    return {
      relation: "incomparable",
      basis: "none",
      componentCounterDecrease,
      componentBreakdownExact: false,
      componentConsistencyMismatch: false,
      sameAggregateDifferentComponents: false,
    };
  }

  const primaryReset = pair.basis === "input-output" && (current.input < previous.input || current.output < previous.output);
  const relation: RawCumulativeRelation = primaryReset
    ? "reset"
    : pair.current < pair.previous ? "reset" : pair.current === pair.previous ? "same" : "increased";
  const aggregateDelta = relation === "increased" ? pair.current - pair.previous : undefined;
  const candidateRawDelta = canDeriveExactComponentDelta(current, previous, relation)
    ? deriveExactRawComponentDelta(current, previous)
    : undefined;
  const componentDeltaTotal = candidateRawDelta ? componentTotalOf(candidateRawDelta) : undefined;
  const componentBreakdownExact = candidateRawDelta !== undefined && aggregateDelta !== undefined && componentDeltaTotal === aggregateDelta;
  return {
    relation,
    basis: pair.basis,
    previousComparableTotal: pair.previous,
    currentComparableTotal: pair.current,
    aggregateDelta,
    componentCounterDecrease,
    componentBreakdownExact,
    rawDelta: componentBreakdownExact ? candidateRawDelta : undefined,
    componentDeltaTotal,
    componentConsistencyMismatch: componentDeltaTotal !== undefined && aggregateDelta !== undefined && componentDeltaTotal !== aggregateDelta,
    sameAggregateDifferentComponents: relation === "same" && !sameComponentCounters(current, previous),
  };
}

const hasTokens = (usage: TokenUsage): boolean => totalTokens(usage) > 0;
/** Carries a trusted aggregate count through TokenUsage when its component split cannot be proven. */
const aggregateUsage = (tokens: number): TokenUsage => ({
  inputTokens: Math.max(tokens, 0),
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
});

interface SnapshotUsageResolution {
  usage: TokenUsage;
  componentBreakdownExact: boolean;
  componentTotal: number;
  consistencyMismatch: boolean;
}

function resolveSnapshotUsage(raw: RawTokenUsage, expectedAggregate: number | undefined): SnapshotUsageResolution {
  const componentUsage = normalizeRawTokenUsage(raw);
  const componentTotal = totalTokens(componentUsage);
  if (expectedAggregate === undefined)
    return { usage: componentUsage, componentBreakdownExact: false, componentTotal, consistencyMismatch: false };
  if (!hasPrimaryComponentBreakdown(raw))
    return { usage: aggregateUsage(expectedAggregate), componentBreakdownExact: false, componentTotal, consistencyMismatch: false };
  if (componentTotal === expectedAggregate)
    return { usage: componentUsage, componentBreakdownExact: true, componentTotal, consistencyMismatch: false };
  return { usage: aggregateUsage(expectedAggregate), componentBreakdownExact: false, componentTotal, consistencyMismatch: true };
}

/** Derives one deterministic TokenCount contribution without consulting a cursor baseline. */
export function deriveTokenCountContribution(
  event: CodexAccountingEvent,
  state: TokenCountState,
): AccountingContribution | undefined {
  const tokenCount = event.tokenCount;
  if (!tokenCount?.last && !tokenCount?.total) return undefined;

  const lastUsage = tokenCount.last ? normalizeRawTokenUsage(tokenCount.last) : undefined;
  const comparison = tokenCount.total ? compareRawCumulative(tokenCount.total, state) : undefined;
  const counterReset = comparison?.relation === "reset";
  const repeatedTotalWithNonZeroLast = !!lastUsage && comparison?.relation === "same" && hasTokens(lastUsage);

  let usage: TokenUsage;
  let method: TokenCountAccountingMethod;
  let componentBreakdownExact = comparison?.componentBreakdownExact ?? false;
  let componentConsistencyMismatch = comparison?.componentConsistencyMismatch ?? false;
  let componentDeltaTotal = comparison?.componentDeltaTotal;
  if (lastUsage) {
    usage = lastUsage;
    method = "last";
  } else {
    const relation = comparison?.relation;
    if (relation === "initial") {
      const snapshot = resolveSnapshotUsage(tokenCount.total!, comparison?.currentComparableTotal);
      usage = snapshot.usage;
      method = "total-initial";
      componentBreakdownExact = snapshot.componentBreakdownExact;
      componentConsistencyMismatch = snapshot.consistencyMismatch;
    } else if (relation === "same") {
      usage = zeroUsage();
      method = "duplicate-zero";
    } else if (relation === "increased" && comparison?.componentBreakdownExact && comparison.rawDelta) {
      usage = normalizeRawTokenUsage(comparison.rawDelta);
      method = "total-delta";
    } else if (relation === "increased" && comparison?.aggregateDelta !== undefined) {
      usage = aggregateUsage(comparison.aggregateDelta);
      method = "total-aggregate-delta";
    } else if (relation === "reset" && comparison?.currentComparableTotal !== undefined) {
      const snapshot = resolveSnapshotUsage(tokenCount.total!, comparison.currentComparableTotal);
      usage = snapshot.usage;
      method = "total-reset";
      componentBreakdownExact = snapshot.componentBreakdownExact;
      componentConsistencyMismatch = snapshot.consistencyMismatch;
    } else {
      usage = zeroUsage();
      method = "unresolved";
    }
  }

  return {
    usage,
    method,
    nextState: {
      previousTotalRaw: tokenCount.total ?? state.previousTotalRaw,
      previousAggregateTotal: tokenCount.total
        ? effectiveAggregateTotal(tokenCount.total) ?? state.previousAggregateTotal
        : state.previousAggregateTotal,
      segment: state.segment + (counterReset ? 1 : 0),
    },
    diagnostics: {
      counterReset,
      repeatedTotalWithNonZeroLast,
      comparisonBasis: comparison?.basis ?? "none",
      componentCounterDecrease: comparison?.componentCounterDecrease ?? false,
      componentBreakdownExact,
      aggregateDelta: comparison?.aggregateDelta,
      incomparable: comparison?.relation === "incomparable",
      sameAggregateDifferentComponents: comparison?.sameAggregateDifferentComponents ?? false,
      componentDeltaTotal,
      componentConsistencyMismatch,
    },
  };
}

export interface TokenCountIdentity {
  sessionId?: string;
  timestamp?: number;
  responseId?: string;
  turnId?: string;
  lastFingerprint?: string;
  totalFingerprint?: string;
}

const rawFingerprint = (usage: RawTokenUsage | undefined): string | undefined =>
  usage ? JSON.stringify(usage) : undefined;

export function tokenCountIdentity(event: CodexAccountingEvent): TokenCountIdentity {
  return {
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    responseId: event.responseId,
    turnId: event.turnId,
    lastFingerprint: rawFingerprint(event.tokenCount?.last),
    totalFingerprint: rawFingerprint(event.tokenCount?.total),
  };
}

export interface TokenCountDeduplicationResult {
  events: CodexAccountingEvent[];
  exactDuplicateCount: number;
}

/** Production v5 only hard-deduplicates the explicit raw identity. */
export function deduplicateTokenCountEvents(
  events: readonly CodexAccountingEvent[],
): TokenCountDeduplicationResult {
  const seen = new Set<string>();
  const unique: CodexAccountingEvent[] = [];
  let exactDuplicateCount = 0;
  for (const event of events) {
    const scope = event.sessionId ?? event.sourcePath;
    const key = `${scope}\n${event.rawIdentity}`;
    if (seen.has(key)) {
      exactDuplicateCount += 1;
      continue;
    }
    seen.add(key);
    unique.push(event);
  }
  return { events: unique, exactDuplicateCount };
}

/** Uses only explicit event time; never guesses from file metadata or Date.now(). */
export function deterministicAccountingTimestamp(
  event: Pick<CodexAccountingEvent, "timestamp">,
): number | undefined {
  const timestamp = event.timestamp;
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : undefined;
}
