import type { UsageRecord } from "@lw-aiusage/core";
import { zeroUsage } from "@lw-aiusage/core";
import type { UnknownCodexEvent, CodexParseContext } from "./types";

const numberAt = (value: unknown, ...keys: string[]): number => {
  let current: unknown = value;
  for (const key of keys) { if (typeof current !== "object" || current === null) return 0; current = (current as Record<string, unknown>)[key]; }
  return typeof current === "number" && Number.isFinite(current) ? current : 0;
};
const stringAt = (value: unknown, ...keys: string[]): string | undefined => {
  let current: unknown = value;
  for (const key of keys) { if (typeof current !== "object" || current === null) return undefined; current = (current as Record<string, unknown>)[key]; }
  return typeof current === "string" ? current : undefined;
};
const timestampOf = (event: UnknownCodexEvent, fallback: number): number => { const value = event.timestamp; if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value; if (typeof value === "string") { const parsed = Date.parse(value); if (Number.isFinite(parsed)) return parsed; } return fallback; };

export function parseCodexEvent(event: UnknownCodexEvent, context: CodexParseContext, sourceId: string, lineIndex: number): { record?: UsageRecord; model?: string; sessionId?: string; projectKey?: string } {
  const type = typeof event.type === "string" ? event.type : "";
  const payload = event.payload ?? event;
  const model = stringAt(payload, "model") ?? stringAt(event, "model") ?? context.currentModel;
  const sessionId = stringAt(payload, "session_id") ?? stringAt(payload, "sessionId") ?? context.sessionId;
  const projectKey = stringAt(payload, "cwd") ?? stringAt(payload, "project") ?? context.projectKey;
  const usageNode = (typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).usage : undefined) ?? payload;
  const hasUsage = typeof usageNode === "object" && usageNode !== null && ["input_tokens", "inputTokens", "output_tokens", "outputTokens", "total_tokens", "totalTokens", "reasoning_output_tokens"].some((key) => key in (usageNode as Record<string, unknown>));
  const result: { record?: UsageRecord; model?: string; sessionId?: string; projectKey?: string } = { model, sessionId, projectKey };
  if (!hasUsage || !model) return result;
  const usage = zeroUsage();
  usage.inputTokens = numberAt(usageNode, "input_tokens") || numberAt(usageNode, "inputTokens");
  usage.cachedInputTokens = numberAt(usageNode, "cached_input_tokens") || numberAt(usageNode, "cachedInputTokens");
  usage.cacheCreationInputTokens = numberAt(usageNode, "cache_creation_input_tokens") || numberAt(usageNode, "cacheCreationInputTokens");
  usage.outputTokens = numberAt(usageNode, "output_tokens") || numberAt(usageNode, "outputTokens");
  usage.reasoningOutputTokens = numberAt(usageNode, "reasoning_output_tokens") || numberAt(usageNode, "reasoningOutputTokens");
  const total = numberAt(usageNode, "total_tokens") || numberAt(usageNode, "totalTokens");
  if (total && usage.inputTokens + usage.cachedInputTokens + usage.cacheCreationInputTokens + usage.outputTokens + usage.reasoningOutputTokens === 0) usage.inputTokens = total;
  const timestamp = timestampOf(event, Date.now());
  result.record = { id: `${sourceId}:${lineIndex}`, source: "codex", sessionId, timestamp, model, rawModel: model, projectKey: projectKey ?? "unknown", usage };
  return result;
}
