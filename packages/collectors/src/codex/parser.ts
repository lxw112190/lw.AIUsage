import type { TokenUsage, UsageRecord } from "@lw-aiusage/core";
import { zeroUsage } from "@lw-aiusage/core";
import { objectValue, stableEventId, stringValue } from "../shared/identity";
import type { UnknownCodexEvent, CodexParseContext } from "./types";

const numberAt = (value: unknown, ...keys: string[]): number => {
  let current: unknown = value;
  for (const key of keys) current = objectValue(current)?.[key];
  return typeof current === "number" && Number.isFinite(current) ? current : 0;
};
const firstNumber = (value: unknown, ...keys: string[]): number => {
  for (const key of keys) {
    const candidate = numberAt(value, key);
    if (candidate !== 0 || objectValue(value)?.[key] === 0) return candidate;
  }
  return 0;
};
const stringAt = (value: unknown, ...keys: string[]): string | undefined => {
  let current: unknown = value;
  for (const key of keys) current = objectValue(current)?.[key];
  return stringValue(current);
};
const firstString = (value: unknown, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const candidate = stringAt(value, key);
    if (candidate) return candidate;
  }
  return undefined;
};
const timestampOf = (event: UnknownCodexEvent, fallback: number): number => {
  if (typeof event.timestamp === "number")
    return event.timestamp < 10_000_000_000
      ? event.timestamp * 1000
      : event.timestamp;
  if (typeof event.timestamp === "string") {
    const parsed = Date.parse(event.timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};
const hasUsageFields = (value: unknown): boolean => {
  const object = objectValue(value);
  return (
    !!object &&
    [
      "input_tokens",
      "inputTokens",
      "cached_input_tokens",
      "output_tokens",
      "outputTokens",
      "total_tokens",
      "totalTokens",
      "reasoning_output_tokens",
    ].some((key) => key in object)
  );
};

interface RawUsage {
  input: number;
  cachedInput: number;
  cacheCreationInput: number;
  output: number;
  reasoningOutput: number;
  total: number;
}
const rawUsageOf = (value: unknown): RawUsage => ({
  input: firstNumber(value, "input_tokens", "inputTokens"),
  cachedInput: firstNumber(value, "cached_input_tokens", "cachedInputTokens"),
  cacheCreationInput: firstNumber(
    value,
    "cache_write_input_tokens",
    "cache_creation_input_tokens",
    "cacheCreationInputTokens",
  ),
  output: firstNumber(value, "output_tokens", "outputTokens"),
  reasoningOutput: firstNumber(
    value,
    "reasoning_output_tokens",
    "reasoningOutputTokens",
  ),
  total: firstNumber(value, "total_tokens", "totalTokens"),
});

/** Codex reports input/output totals that include their cached/reasoning components. */
const normalizeUsage = (raw: RawUsage): TokenUsage => {
  const usage = zeroUsage();
  usage.cachedInputTokens = raw.cachedInput;
  usage.cacheCreationInputTokens = raw.cacheCreationInput;
  usage.inputTokens = Math.max(raw.input - raw.cachedInput, 0);
  usage.reasoningOutputTokens = raw.reasoningOutput;
  usage.outputTokens = Math.max(raw.output - raw.reasoningOutput, 0);
  if (
    raw.total > 0 &&
    raw.input === 0 &&
    raw.output === 0 &&
    raw.reasoningOutput === 0 &&
    raw.cachedInput === 0
  )
    usage.inputTokens = raw.total;
  return usage;
};
const subtractUsage = (
  current: TokenUsage,
  previous: TokenUsage | undefined,
): TokenUsage => {
  if (!previous) return current;
  return {
    inputTokens: Math.max(current.inputTokens - previous.inputTokens, 0),
    cachedInputTokens: Math.max(
      current.cachedInputTokens - previous.cachedInputTokens,
      0,
    ),
    cacheCreationInputTokens: Math.max(
      current.cacheCreationInputTokens - previous.cacheCreationInputTokens,
      0,
    ),
    outputTokens: Math.max(current.outputTokens - previous.outputTokens, 0),
    reasoningOutputTokens: Math.max(
      current.reasoningOutputTokens - previous.reasoningOutputTokens,
      0,
    ),
  };
};
const hasTokens = (usage: TokenUsage): boolean =>
  Object.values(usage).some((value) => value > 0);

export interface CodexParseResult {
  record?: UsageRecord;
  model?: string;
  sessionId?: string;
  projectKey?: string;
  state: CodexParseContext;
}

export function parseCodexEvent(
  event: UnknownCodexEvent,
  context: CodexParseContext,
  sourceId: string,
  _lineIndex: number,
): CodexParseResult {
  const payload = objectValue(event.payload) ?? event;
  const msg = objectValue(payload.msg);
  const nestedInfo = objectValue(payload.info) ?? objectValue(msg?.info) ?? objectValue(event.info);
  const lastNode = nestedInfo?.last_token_usage ?? nestedInfo?.lastTokenUsage;
  const totalNode = nestedInfo?.total_token_usage ?? nestedInfo?.totalTokenUsage;
  const model =
    stringAt(payload, "model") ??
    stringAt(nestedInfo, "model") ??
    stringAt(msg, "model") ??
    stringAt(event, "model") ??
    context.currentModel;
  const eventType = stringAt(event, "type");
  const sessionId = (eventType === "session_meta" ? firstString(payload, "id") : undefined) ??
    firstString(payload, "session_id", "sessionId") ??
    firstString(msg, "session_id", "sessionId") ??
    firstString(event, "session_id", "sessionId") ??
    context.sessionId;
  const projectKey =
    stringAt(payload, "cwd") ??
    stringAt(payload, "project") ??
    context.projectKey;
  const state: CodexParseContext = {
    ...context,
    sessionId,
    projectKey,
    currentModel: model,
    previousTotalUsage: context.previousTotalUsage,
  };
  const forkedFromSessionId = firstString(payload, "forked_from_id", "forkedFromId") ?? firstString(msg, "forked_from_id", "forkedFromId");
  if (forkedFromSessionId) {
    state.forkedFromSessionId = forkedFromSessionId;
    state.forkBaselineApplied = false;
  }
  const flatUsageNode =
    objectValue(payload.usage) ??
    (hasUsageFields(payload) ? payload : undefined);
  const usageNode = lastNode ?? totalNode ?? flatUsageNode;
  if (!usageNode || !model || !hasUsageFields(usageNode))
    return { model, sessionId, projectKey, state };

  const normalizedTotal =
    totalNode && hasUsageFields(totalNode)
      ? normalizeUsage(rawUsageOf(totalNode))
      : undefined;
  if (normalizedTotal) state.previousTotalUsage = normalizedTotal;
  const previousTotal = context.previousTotalUsage ?? state.forkBaselineUsage;
  const usage =
    lastNode && hasUsageFields(lastNode)
      ? totalNode && state.forkBaselineUsage && !context.previousTotalUsage
        ? subtractUsage(normalizeUsage(rawUsageOf(totalNode)), state.forkBaselineUsage)
        : normalizeUsage(rawUsageOf(lastNode))
      : totalNode
        ? subtractUsage(
            normalizeUsage(rawUsageOf(usageNode)),
            previousTotal,
          )
        : normalizeUsage(rawUsageOf(usageNode));
  if (totalNode && state.forkBaselineUsage && !context.previousTotalUsage) state.forkBaselineApplied = true;
  if (!hasTokens(usage)) return { model, sessionId, projectKey, state };

  const timestamp = timestampOf(event, Date.now());
  const recordId = stableEventId("codex", sourceId, event, {
    timestamp: event.timestamp,
    turnId: stringAt(payload, "turn_id", "turnId"),
    responseId: stringAt(payload, "response_id", "responseId"),
    total: totalNode ?? usageNode,
  });
  return {
    model,
    sessionId,
    projectKey,
    state,
    record: {
      id: recordId,
      source: "codex",
      sourcePath: sourceId,
      sessionId,
      timestamp,
      model,
      rawModel: model,
      projectKey: projectKey ?? "unknown",
      usage,
    },
  };
}
