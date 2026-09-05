import { totalTokens, zeroUsage, type TokenUsage } from "@lw-aiusage/core";
import { objectValue } from "../shared/identity";

export interface CodexRawCounters {
  input: number;
  cachedInput: number;
  cacheCreationInput: number;
  output: number;
  reasoningOutput: number;
  total: number;
}

export const zeroRawCounters = (): CodexRawCounters => ({
  input: 0,
  cachedInput: 0,
  cacheCreationInput: 0,
  output: 0,
  reasoningOutput: 0,
  total: 0,
});

export const copyRawCounters = (value: CodexRawCounters): CodexRawCounters => ({ ...value });
export const hasRawCounters = (value: CodexRawCounters | undefined): value is CodexRawCounters =>
  !!value && Object.values(value).some((item) => item > 0);

export function rawCountersFrom(value: unknown): CodexRawCounters | undefined {
  const object = objectValue(value);
  if (!object) return undefined;
  const number = (...keys: string[]): number => {
    for (const key of keys) {
      const candidate = object[key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    }
    return 0;
  };
  const result = {
    input: number("input_tokens", "inputTokens"),
    cachedInput: number("cached_input_tokens", "cachedInputTokens"),
    cacheCreationInput: number("cache_creation_input_tokens", "cacheCreationInputTokens", "cache_write_input_tokens"),
    output: number("output_tokens", "outputTokens"),
    reasoningOutput: number("reasoning_output_tokens", "reasoningOutputTokens"),
    total: number("total_tokens", "totalTokens"),
  };
  return hasRawCounters(result) ? result : undefined;
}

export function addRawCounters(target: CodexRawCounters, value: CodexRawCounters): void {
  target.input += value.input;
  target.cachedInput += value.cachedInput;
  target.cacheCreationInput += value.cacheCreationInput;
  target.output += value.output;
  target.reasoningOutput += value.reasoningOutput;
  target.total += value.total;
}

export function subtractRawCounters(current: CodexRawCounters, previous: CodexRawCounters): CodexRawCounters {
  return {
    input: current.input - previous.input,
    cachedInput: current.cachedInput - previous.cachedInput,
    cacheCreationInput: current.cacheCreationInput - previous.cacheCreationInput,
    output: current.output - previous.output,
    reasoningOutput: current.reasoningOutput - previous.reasoningOutput,
    total: current.total - previous.total,
  };
}

export function positiveRawDelta(current: CodexRawCounters, previous?: CodexRawCounters): CodexRawCounters {
  if (!previous) return copyRawCounters(current);
  const delta = subtractRawCounters(current, previous);
  return {
    input: Math.max(delta.input, 0),
    cachedInput: Math.max(delta.cachedInput, 0),
    cacheCreationInput: Math.max(delta.cacheCreationInput, 0),
    output: Math.max(delta.output, 0),
    reasoningOutput: Math.max(delta.reasoningOutput, 0),
    total: Math.max(delta.total, 0),
  };
}

export function rawCounterTotal(value: CodexRawCounters): number {
  return value.total > 0 ? value.total : value.input + value.output;
}

export function sameRawCounters(left: CodexRawCounters, right: CodexRawCounters): boolean {
  return left.input === right.input && left.cachedInput === right.cachedInput &&
    left.cacheCreationInput === right.cacheCreationInput && left.output === right.output &&
    left.reasoningOutput === right.reasoningOutput;
}

export function counterDecrease(current: CodexRawCounters, previous: CodexRawCounters): boolean {
  return current.input < previous.input || current.cachedInput < previous.cachedInput ||
    current.cacheCreationInput < previous.cacheCreationInput || current.output < previous.output ||
    current.reasoningOutput < previous.reasoningOutput;
}

/** Codex input/output counters include cached/reasoning components. */
export function normalizeRawCounters(raw: CodexRawCounters): TokenUsage {
  const usage = zeroUsage();
  usage.cachedInputTokens = raw.cachedInput;
  usage.cacheCreationInputTokens = raw.cacheCreationInput;
  usage.inputTokens = Math.max(raw.input - raw.cachedInput, 0);
  usage.reasoningOutputTokens = raw.reasoningOutput;
  usage.outputTokens = Math.max(raw.output - raw.reasoningOutput, 0);
  if (raw.total > 0 && raw.input === 0 && raw.output === 0 && raw.reasoningOutput === 0 && raw.cachedInput === 0)
    usage.inputTokens = raw.total;
  return usage;
}

export const normalizedTotal = (value: CodexRawCounters): number => totalTokens(normalizeRawCounters(value));
