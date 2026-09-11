import {
  addLocalDays,
  addUsage,
  aggregateBuckets,
  cachedInputShare,
  estimatedCostUsd,
  localDayKey,
  pricingForModel,
  startOfLocalDay,
  totalTokens,
  zeroUsage,
  type AgentSource,
  type TokenUsage,
  type UsageBucket,
} from "@lw-aiusage/core";
import type { UsageRepository } from "@lw-aiusage/storage";
import { pricingCoverageForBuckets, type PricingCoverageSummary } from "./pricingCoverage";
import { SessionUsageService, type UsageSessionSummary } from "./sessionUsage";

export type ProjectInsightRange = "last30" | "last90" | "all";
export interface ProjectPeriodSummary { from: number; to: number; currentTokens: number; previousTokens: number; deltaTokens: number; changePercent?: number; }
export interface ProjectTrendPoint { day: string; timestamp: number; usage: TokenUsage; totalTokens: number; estimatedCostUsd: number; }
export interface ProjectBreakdown { key: string; recordCount: number; totalTokens: number; share: number; estimatedCostUsd: number; }
export interface ProjectInsight {
  projectKey: string;
  firstActiveAt?: number;
  lastActiveAt?: number;
  recordCount: number;
  sessionCount: number;
  usage: TokenUsage;
  totalTokens: number;
  cachedInputShare?: number;
  pricing: PricingCoverageSummary;
  currentPeriod: ProjectPeriodSummary;
  trend: ProjectTrendPoint[];
  bySource: ProjectBreakdown[];
  byModel: ProjectBreakdown[];
  topSessions: UsageSessionSummary[];
}

const daysFor = (range: ProjectInsightRange): number | undefined => range === "last30" ? 30 : range === "last90" ? 90 : undefined;
const sumBuckets = (buckets: readonly UsageBucket[]): TokenUsage => buckets.reduce((sum, bucket) => addUsage(sum, bucket.usage), zeroUsage());
const tokensBetween = (buckets: readonly UsageBucket[], from: number, to: number): number => buckets.reduce((sum, bucket) => sum + (bucket.bucketStart >= from && bucket.bucketStart < to ? totalTokens(bucket.usage) : 0), 0);
const costFor = (bucket: UsageBucket): number => { const pricing = pricingForModel(bucket.model); return pricing ? estimatedCostUsd(bucket.usage, pricing) : 0; };
const breakdown = (buckets: readonly UsageBucket[], keyOf: (bucket: UsageBucket) => string): ProjectBreakdown[] => {
  const groups = new Map<string, ProjectBreakdown>();
  for (const bucket of buckets) {
    const key = keyOf(bucket); const tokens = totalTokens(bucket.usage); const current = groups.get(key);
    if (current) { current.recordCount += bucket.recordCount; current.totalTokens += tokens; current.estimatedCostUsd += costFor(bucket); }
    else groups.set(key, { key, recordCount: bucket.recordCount, totalTokens: tokens, share: 0, estimatedCostUsd: costFor(bucket) });
  }
  const total = [...groups.values()].reduce((sum, item) => sum + item.totalTokens, 0);
  return [...groups.values()].map((item) => ({ ...item, share: total > 0 ? item.totalTokens / total : 0 })).sort((left, right) => right.totalTokens - left.totalTokens);
};

export class ProjectInsightService {
  constructor(private readonly repository: UsageRepository) {}

  async get(projectKey: string, range: ProjectInsightRange = "last30", now = Date.now()): Promise<ProjectInsight | undefined> {
    const [storedBuckets, records] = await Promise.all([this.repository.getBuckets({ projectKey }), this.repository.getRecords({ projectKey })]);
    const buckets = storedBuckets.length ? storedBuckets : aggregateBuckets(records);
    if (!buckets.length && !records.length) return undefined;
    const today = startOfLocalDay(now);
    const firstActiveAt = records.reduce<number | undefined>((min, record) => Math.min(min ?? record.timestamp, record.timestamp), undefined);
    const lastActiveAt = records.reduce<number | undefined>((max, record) => Math.max(max ?? record.timestamp, record.timestamp), undefined);
    const span = daysFor(range);
    const currentFrom = span ? addLocalDays(today, -(span - 1)) : startOfLocalDay(firstActiveAt ?? today);
    const currentTo = addLocalDays(today, 1);
    const elapsedDays = Math.max(1, Math.round((currentTo - currentFrom) / 86_400_000));
    const previousFrom = addLocalDays(currentFrom, -elapsedDays);
    const currentTokens = tokensBetween(buckets, currentFrom, currentTo);
    const previousTokens = tokensBetween(buckets, previousFrom, currentFrom);
    const usage = sumBuckets(buckets); const total = totalTokens(usage); const share = cachedInputShare(usage);
    const trendStart = currentFrom; const trend: ProjectTrendPoint[] = [];
    for (let timestamp = trendStart; timestamp < currentTo; timestamp = addLocalDays(timestamp, 1)) {
      const dayBuckets = buckets.filter((bucket) => startOfLocalDay(bucket.bucketStart) === timestamp);
      const dayUsage = sumBuckets(dayBuckets);
      trend.push({ day: localDayKey(timestamp), timestamp, usage: dayUsage, totalTokens: totalTokens(dayUsage), estimatedCostUsd: dayBuckets.reduce((sum, bucket) => sum + costFor(bucket), 0) });
    }
    const currentPeriod: ProjectPeriodSummary = { from: currentFrom, to: currentTo, currentTokens, previousTokens, deltaTokens: currentTokens - previousTokens, ...(previousTokens > 0 ? { changePercent: (currentTokens - previousTokens) / previousTokens * 100 } : {}) };
    const sessionService = new SessionUsageService(this.repository);
    return { projectKey, firstActiveAt, lastActiveAt, recordCount: records.length, sessionCount: new Set(records.flatMap((record) => record.sessionId ? [`${record.source}:${record.sessionId}`] : [])).size, usage, totalTokens: total, ...(share === undefined ? {} : { cachedInputShare: share }), pricing: pricingCoverageForBuckets(buckets), currentPeriod, trend, bySource: breakdown(buckets, (bucket) => bucket.source), byModel: breakdown(buckets, (bucket) => bucket.model), topSessions: await sessionService.topForProject(projectKey) };
  }
}
