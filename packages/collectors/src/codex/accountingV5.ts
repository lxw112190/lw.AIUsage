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
  rawIdentity: string;
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

export interface TokenCountState {
  previousTotal?: TokenUsage;
  segment: number;
}

export type TokenCountAccountingMethod =
  | "last"
  | "total-initial"
  | "total-delta"
  | "total-reset"
  | "duplicate-zero";

export interface AccountingContribution {
  usage: TokenUsage;
  method: TokenCountAccountingMethod;
  nextState: TokenCountState;
  diagnostics: {
    counterReset: boolean;
    repeatedTotalWithNonZeroLast: boolean;
  };
}

const numberAt = (object: Record<string, unknown>, key: string): number => {
  const value = object[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(value, 0) : 0;
};

const hasKey = (object: Record<string, unknown>, key: string): boolean => key in object;

const firstPresentNumber = (
  object: Record<string, unknown>,
  keys: readonly string[],
): { value: number; present: boolean } => {
  for (const key of keys) {
    if (hasKey(object, key)) return { value: numberAt(object, key), present: true };
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

const sameUsage = (left: TokenUsage, right: TokenUsage): boolean =>
  left.inputTokens === right.inputTokens &&
  left.cachedInputTokens === right.cachedInputTokens &&
  left.cacheCreationInputTokens === right.cacheCreationInputTokens &&
  left.outputTokens === right.outputTokens &&
  left.reasoningOutputTokens === right.reasoningOutputTokens;

const usageDecreased = (current: TokenUsage, previous: TokenUsage): boolean =>
  current.inputTokens < previous.inputTokens ||
  current.cachedInputTokens < previous.cachedInputTokens ||
  current.cacheCreationInputTokens < previous.cacheCreationInputTokens ||
  current.outputTokens < previous.outputTokens ||
  current.reasoningOutputTokens < previous.reasoningOutputTokens;

const positiveDelta = (current: TokenUsage, previous: TokenUsage): TokenUsage => ({
  inputTokens: Math.max(current.inputTokens - previous.inputTokens, 0),
  cachedInputTokens: Math.max(current.cachedInputTokens - previous.cachedInputTokens, 0),
  cacheCreationInputTokens: Math.max(current.cacheCreationInputTokens - previous.cacheCreationInputTokens, 0),
  outputTokens: Math.max(current.outputTokens - previous.outputTokens, 0),
  reasoningOutputTokens: Math.max(current.reasoningOutputTokens - previous.reasoningOutputTokens, 0),
});

const hasTokens = (usage: TokenUsage): boolean => totalTokens(usage) > 0;

/** Derives one deterministic TokenCount contribution without consulting a cursor baseline. */
export function deriveTokenCountContribution(
  event: CodexAccountingEvent,
  state: TokenCountState,
): AccountingContribution | undefined {
  const tokenCount = event.tokenCount;
  if (!tokenCount?.last && !tokenCount?.total) return undefined;

  const lastUsage = tokenCount.last ? normalizeRawTokenUsage(tokenCount.last) : undefined;
  const totalUsage = tokenCount.total ? normalizeRawTokenUsage(tokenCount.total) : undefined;
  const previousTotal = state.previousTotal;
  const counterReset = !!totalUsage && !!previousTotal && usageDecreased(totalUsage, previousTotal);
  const repeatedTotalWithNonZeroLast = !!lastUsage && !!totalUsage && !!previousTotal && sameUsage(totalUsage, previousTotal) && hasTokens(lastUsage);

  let usage: TokenUsage;
  let method: TokenCountAccountingMethod;
  if (lastUsage) {
    usage = lastUsage;
    method = counterReset ? "total-reset" : "last";
  } else if (totalUsage && counterReset) {
    usage = totalUsage;
    method = "total-reset";
  } else if (totalUsage && !previousTotal) {
    usage = totalUsage;
    method = "total-initial";
  } else if (totalUsage && sameUsage(totalUsage, previousTotal!)) {
    usage = zeroUsage();
    method = "duplicate-zero";
  } else if (totalUsage) {
    usage = positiveDelta(totalUsage, previousTotal!);
    method = "total-delta";
  } else {
    usage = lastUsage ?? zeroUsage();
    method = "last";
  }

  return {
    usage,
    method,
    nextState: {
      previousTotal: totalUsage ?? previousTotal,
      segment: state.segment + (counterReset ? 1 : 0),
    },
    diagnostics: { counterReset, repeatedTotalWithNonZeroLast },
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
    if (seen.has(event.rawIdentity)) {
      exactDuplicateCount += 1;
      continue;
    }
    seen.add(event.rawIdentity);
    unique.push(event);
  }
  return { events: unique, exactDuplicateCount };
}

/** Uses only explicit event time, then the deterministic file metadata fallback; never Date.now(). */
export function deterministicAccountingTimestamp(
  event: Pick<CodexAccountingEvent, "timestamp">,
  fileModifiedAt?: number,
): number | undefined {
  const timestamp = event.timestamp ?? fileModifiedAt;
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : undefined;
}
