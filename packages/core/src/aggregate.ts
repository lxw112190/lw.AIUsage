import type { TokenUsage, UsageBucket, UsageRecord } from "./models";
import { addUsage, totalTokens, zeroUsage } from "./models";

export const BUCKET_MS = 30 * 60 * 1000;

export const bucketStart = (timestamp: number): number => Math.floor(timestamp / BUCKET_MS) * BUCKET_MS;

export function aggregateUsage(records: readonly UsageRecord[]): TokenUsage {
  return records.reduce((sum, record) => addUsage(sum, record.usage), zeroUsage());
}

export function aggregateBuckets(records: readonly UsageRecord[]): UsageBucket[] {
  const buckets = new Map<string, UsageBucket>();
  const sessions = new Map<string, Set<string>>();
  for (const record of records) {
    const start = bucketStart(record.timestamp);
    const id = `${record.source}:${record.model}:${record.projectKey}:${start}`;
    const current = buckets.get(id);
    if (current) {
      current.usage = addUsage(current.usage, record.usage);
      current.recordCount += 1;
      const bucketSessions = sessions.get(id);
      bucketSessions?.add(record.sessionId ?? record.id);
      current.sessionCount = bucketSessions?.size ?? current.sessionCount + 1;
    } else {
      sessions.set(id, new Set([record.sessionId ?? record.id]));
      buckets.set(id, {
        id,
        bucketStart: start,
        source: record.source,
        model: record.model,
        projectKey: record.projectKey,
        usage: record.usage,
        recordCount: 1,
        sessionCount: 1,
      });
    }
  }
  return [...buckets.values()].sort((a, b) => a.bucketStart - b.bucketStart);
}

export function estimatedCostUsd(usage: TokenUsage, pricing: ModelPricing): number {
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.cachedInputTokens / 1_000_000) * (pricing.cachedInputPerMillion ?? pricing.inputPerMillion) +
    (usage.cacheCreationInputTokens / 1_000_000) * (pricing.cacheCreationPerMillion ?? pricing.inputPerMillion) +
    ((usage.outputTokens + usage.reasoningOutputTokens) / 1_000_000) * pricing.outputPerMillion
  );
}

export interface ModelPricing {
  inputPerMillion: number;
  cachedInputPerMillion?: number;
  cacheCreationPerMillion?: number;
  outputPerMillion: number;
}

export function normalizeModel(rawModel: string): { id: string; displayName: string; provider: string } {
  const raw = rawModel.trim();
  const lower = raw.toLowerCase();
  const provider = lower.includes("claude") ? "Anthropic" : lower.includes("gemini") ? "Google" : "OpenAI";
  const displayName = raw.replace(/^model[-_]?/i, "").replace(/[-_]\d{8,}$/, "");
  return { id: lower || "unknown", displayName: displayName || "Unknown model", provider };
}

export { totalTokens };
