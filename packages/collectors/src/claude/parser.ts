import type { UsageRecord } from "@lw-aiusage/core";
import { zeroUsage } from "@lw-aiusage/core";
import type { ClaudeParseContext, UnknownClaudeEvent } from "./types";

const recordOf = (value: unknown): Record<string, unknown> | undefined => typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
const numberAt = (value: unknown, key: string): number => { const object = recordOf(value); const candidate = object?.[key]; return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0; };
const stringAt = (value: unknown, ...keys: string[]): string | undefined => { let current: unknown = value; for (const key of keys) { const object = recordOf(current); current = object?.[key]; } return typeof current === "string" && current.length > 0 ? current : undefined; };
const timestampOf = (event: UnknownClaudeEvent, fallback: number): number => { if (typeof event.timestamp === "number") return event.timestamp < 10_000_000_000 ? event.timestamp * 1000 : event.timestamp; if (typeof event.timestamp === "string") { const value = Date.parse(event.timestamp); if (Number.isFinite(value)) return value; } return fallback; };
const projectName = (cwd: string | undefined, fallback: string): string => { if (!cwd) return fallback; const normalized = cwd.replace(/[\\/]+$/, ""); const segments = normalized.split(/[\\/]/); return segments.at(-1) || fallback; };

export function parseClaudeEvent(event: UnknownClaudeEvent, context: ClaudeParseContext, sourceId: string, lineIndex: number): { record?: UsageRecord; model?: string; sessionId?: string; projectKey?: string } {
  const message = recordOf(event.message);
  const usage = message?.usage ?? recordOf(event)?.usage;
  const hasUsage = recordOf(usage) !== undefined && ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"].some((key) => key in (recordOf(usage) ?? {}));
  const model = stringAt(message, "model") ?? stringAt(event, "model") ?? context.currentModel;
  const sessionId = stringAt(event, "sessionId") ?? stringAt(event, "session_id") ?? context.sessionId;
  const cwd = stringAt(event, "cwd") ?? stringAt(message, "cwd");
  const projectKey = projectName(cwd, context.projectKey);
  const result: { record?: UsageRecord; model?: string; sessionId?: string; projectKey?: string } = { model, sessionId, projectKey };
  if (!hasUsage || !model) return result;
  const safeUsage = recordOf(usage) ?? {};
  const normalized = zeroUsage();
  normalized.inputTokens = numberAt(safeUsage, "input_tokens");
  normalized.cachedInputTokens = numberAt(safeUsage, "cache_read_input_tokens");
  normalized.cacheCreationInputTokens = numberAt(safeUsage, "cache_creation_input_tokens");
  normalized.outputTokens = numberAt(safeUsage, "output_tokens");
  const stableEventId = stringAt(event, "uuid") ?? stringAt(event, "id") ?? `${sourceId}:${lineIndex}`;
  result.record = { id: `claude:${stableEventId}`, source: "claude", sessionId, timestamp: timestampOf(event, Date.now()), model, rawModel: model, projectKey, usage: normalized };
  return result;
}
