import type { TokenUsage, UsageRecord } from "@lw-aiusage/core";
import { zeroUsage } from "@lw-aiusage/core";
import { objectValue, stableEventId, stableHash, stringValue } from "../shared/identity";
import type { ClaudeParseContext, UnknownClaudeEvent } from "./types";

const numberAt = (value: unknown, key: string): number => {
  const candidate = objectValue(value)?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : 0;
};
const stringAt = (value: unknown, ...keys: string[]): string | undefined => {
  let current: unknown = value;
  for (const key of keys) current = objectValue(current)?.[key];
  return stringValue(current);
};
const firstString = (value: unknown, ...keys: string[]): string | undefined => { for (const key of keys) { const candidate = stringAt(value, key); if (candidate) return candidate; } return undefined; };
const timestampOf = (event: UnknownClaudeEvent, fallback: number): number => {
  if (typeof event.timestamp === "number")
    return event.timestamp < 10_000_000_000
      ? event.timestamp * 1000
      : event.timestamp;
  if (typeof event.timestamp === "string") {
    const value = Date.parse(event.timestamp);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
};
const projectName = (cwd: string | undefined, fallback: string): string => {
  if (!cwd) return fallback;
  const normalized = cwd.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) || fallback;
};
const sameUsage = (left: TokenUsage, right: TokenUsage): boolean => JSON.stringify(left) === JSON.stringify(right);

export interface ClaudeParseResult {
  record?: UsageRecord;
  model?: string;
  sessionId?: string;
  projectKey?: string;
  state: ClaudeParseContext;
}

export function parseClaudeEvent(
  event: UnknownClaudeEvent,
  context: ClaudeParseContext,
  sourceId: string,
  _lineIndex: number,
): ClaudeParseResult {
  const message = objectValue(event.message);
  const usageObject = objectValue(message?.usage ?? objectValue(event)?.usage);
  const hasUsage =
    !!usageObject &&
    [
      "input_tokens",
      "output_tokens",
      "cache_read_input_tokens",
      "cache_creation_input_tokens",
    ].some((key) => key in usageObject);
  const model =
    stringAt(message, "model") ??
    stringAt(event, "model") ??
    context.currentModel;
  const sessionId = firstString(event, "sessionId", "session_id") ?? context.sessionId;
  const projectKey = projectName(
    stringAt(event, "cwd") ?? stringAt(message, "cwd"),
    context.projectKey,
  );
  const seenUsage = { ...(context.seenUsage ?? {}) };
  const state: ClaudeParseContext = {
    sessionId,
    projectKey,
    currentModel: model,
    seenUsage,
  };
  if (!hasUsage || !model) return { model, sessionId, projectKey, state };
  const normalized = zeroUsage();
  normalized.inputTokens = numberAt(usageObject, "input_tokens");
  normalized.cachedInputTokens = numberAt(
    usageObject,
    "cache_read_input_tokens",
  );
  const cacheCreation = numberAt(usageObject, "cache_creation_input_tokens");
  const cacheCreationDetails = objectValue(usageObject.cache_creation);
  const ephemeralCreation = numberAt(cacheCreationDetails, "ephemeral_5m_input_tokens") + numberAt(cacheCreationDetails, "ephemeral_1h_input_tokens");
  normalized.cacheCreationInputTokens = Math.max(cacheCreation, ephemeralCreation);
  normalized.outputTokens = numberAt(usageObject, "output_tokens");
  const messageId = firstString(message, "id");
  const requestId = firstString(event, "requestId", "request_id") ?? firstString(message, "requestId", "request_id");
  const usageKey = messageId ? `${messageId}:${requestId ?? ""}` : undefined;
  const previousUsage = usageKey ? seenUsage[usageKey] : undefined;
  if (usageKey) {
    seenUsage[usageKey] = normalized;
    const keys = Object.keys(seenUsage);
    while (keys.length > 50_000) { const oldest = keys.shift(); if (oldest) delete seenUsage[oldest]; }
  }
  if (previousUsage && sameUsage(previousUsage, normalized)) return { model, sessionId, projectKey, state };
  const recordId = usageKey ? `claude:${stableHash(`${sourceId}\n${usageKey}`)}` : stableEventId("claude", sourceId, event, {
    timestamp: event.timestamp,
    usage: usageObject,
    model,
    sessionId,
    projectKey,
  });
  return {
    model,
    sessionId,
    projectKey,
    state,
    record: {
      id: recordId,
      source: "claude",
      sourcePath: sourceId,
      sessionId,
      timestamp: timestampOf(event, Date.now()),
      model,
      rawModel: model,
      projectKey,
      usage: normalized,
    },
  };
}
