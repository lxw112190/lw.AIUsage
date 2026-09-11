import { totalTokens, type AgentSource, type UsageBucket } from "@lw-aiusage/core";
import type { UsageRepository } from "@lw-aiusage/storage";
import { comparablePeriodWindow, type ComparablePeriodWindow, type ComparisonPeriod } from "./query";

export type ChangeDimension = "source" | "model" | "project";
export type ChangeDriverState = "increased" | "decreased" | "new" | "inactive";
export interface ChangeDriver { key: string; currentTokens: number; previousTokens: number; deltaTokens: number; changePercent?: number; shareOfNetChange?: number; state: ChangeDriverState; }
export interface ChangeDriverResult { period: ComparisonPeriod; from: number; to: number; previousFrom: number; previousTo: number; currentTokens: number; previousTokens: number; netDeltaTokens: number; bySource: ChangeDriver[]; byModel: ChangeDriver[]; byProject: ChangeDriver[]; }

const keyOf = (bucket: UsageBucket, dimension: ChangeDimension): string => dimension === "source" ? bucket.source : dimension === "model" ? bucket.model : bucket.projectKey;
const build = (buckets: readonly UsageBucket[], dimension: ChangeDimension, window: ComparablePeriodWindow): ChangeDriver[] => {
  const groups = new Map<string, { currentTokens: number; previousTokens: number }>();
  for (const bucket of buckets) {
    const timestamp = bucket.bucketStart;
    if (timestamp < window.previousFrom || timestamp >= window.currentTo) continue;
    const key = keyOf(bucket, dimension); const current = groups.get(key) ?? { currentTokens: 0, previousTokens: 0 }; const tokens = totalTokens(bucket.usage);
    if (timestamp >= window.currentFrom) current.currentTokens += tokens; else if (timestamp < window.previousTo) current.previousTokens += tokens;
    groups.set(key, current);
  }
  const net = [...groups.values()].reduce((sum, item) => sum + item.currentTokens - item.previousTokens, 0);
  return [...groups.entries()].map(([key, item]) => { const deltaTokens = item.currentTokens - item.previousTokens; const state: ChangeDriverState = item.previousTokens === 0 && item.currentTokens > 0 ? "new" : item.currentTokens === 0 && item.previousTokens > 0 ? "inactive" : deltaTokens > 0 ? "increased" : "decreased"; return { key, ...item, deltaTokens, ...(item.previousTokens > 0 ? { changePercent: deltaTokens / item.previousTokens * 100 } : {}), ...(net !== 0 ? { shareOfNetChange: deltaTokens / net } : {}), state }; }).sort((left, right) => Math.abs(right.deltaTokens) - Math.abs(left.deltaTokens));
};

export class ChangeDriverService {
  constructor(private readonly repository: UsageRepository) {}
  async get(period: ComparisonPeriod, now = Date.now()): Promise<ChangeDriverResult> {
    const window = comparablePeriodWindow(period, now); const buckets = await this.repository.getBuckets();
    const currentTokens = buckets.reduce((sum, bucket) => sum + (bucket.bucketStart >= window.currentFrom && bucket.bucketStart < window.currentTo ? totalTokens(bucket.usage) : 0), 0);
    const previousTokens = buckets.reduce((sum, bucket) => sum + (bucket.bucketStart >= window.previousFrom && bucket.bucketStart < window.previousTo ? totalTokens(bucket.usage) : 0), 0);
    return { period, from: window.currentFrom, to: window.currentTo, previousFrom: window.previousFrom, previousTo: window.previousTo, currentTokens, previousTokens, netDeltaTokens: currentTokens - previousTokens, bySource: build(buckets, "source", window), byModel: build(buckets, "model", window), byProject: build(buckets, "project", window) };
  }
}
