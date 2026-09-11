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
  type TokenUsage,
  type UsageBucket,
  type UsageRecord,
} from "@lw-aiusage/core";
import type { UsageRepository } from "@lw-aiusage/storage";
import { pricingCoverageForBuckets, type PricingCoverageSummary } from "./pricingCoverage";
import { SessionUsageService, type UsageSessionSummary } from "./sessionUsage";

export type ProjectInsightRange = "last30" | "last90" | "all";
export interface ProjectPeriodSummary {
  from: number;
  to: number;
  currentTokens: number;
  previousTokens: number;
  deltaTokens: number;
  changePercent?: number;
}
export interface ProjectTrendPoint {
  day: string;
  timestamp: number;
  usage: TokenUsage;
  totalTokens: number;
  estimatedCostUsd: number;
}
export interface ProjectBreakdown {
  key: string;
  recordCount: number;
  totalTokens: number;
  share: number;
  estimatedCostUsd: number;
}
export interface ProjectAllTimeSummary {
  firstActiveAt?: number;
  lastActiveAt?: number;
  recordCount: number;
  sessionCount: number;
  usage: TokenUsage;
  totalTokens: number;
}
export interface ProjectRangeInsight {
  range: ProjectInsightRange;
  from: number;
  to: number;
  recordCount: number;
  sessionCount: number;
  usage: TokenUsage;
  totalTokens: number;
  cachedInputShare?: number;
  pricing: PricingCoverageSummary;
  comparison?: ProjectPeriodSummary;
  trend: ProjectTrendPoint[];
  bySource: ProjectBreakdown[];
  byModel: ProjectBreakdown[];
  topSessions: UsageSessionSummary[];
}
export interface ProjectInsight {
  projectKey: string;
  allTime: ProjectAllTimeSummary;
  range: ProjectRangeInsight;
}

const daysFor = (range: ProjectInsightRange): number | undefined =>
  range === "last30" ? 30 : range === "last90" ? 90 : undefined;
const sumBuckets = (buckets: readonly UsageBucket[]): TokenUsage =>
  buckets.reduce((sum, bucket) => addUsage(sum, bucket.usage), zeroUsage());
const sumRecords = (records: readonly UsageRecord[]): TokenUsage =>
  records.reduce((sum, record) => addUsage(sum, record.usage), zeroUsage());
const sessionCount = (records: readonly UsageRecord[]): number =>
  new Set(records.flatMap((record) => record.sessionId ? [`${record.source}:${record.sessionId}`] : [])).size;
const costFor = (bucket: UsageBucket): number => {
  const pricing = pricingForModel(bucket.model);
  return pricing ? estimatedCostUsd(bucket.usage, pricing) : 0;
};
const breakdown = (
  buckets: readonly UsageBucket[],
  keyOf: (bucket: UsageBucket) => string,
): ProjectBreakdown[] => {
  const groups = new Map<string, ProjectBreakdown>();
  for (const bucket of buckets) {
    const key = keyOf(bucket);
    const tokens = totalTokens(bucket.usage);
    const current = groups.get(key);
    if (current) {
      current.recordCount += bucket.recordCount;
      current.totalTokens += tokens;
      current.estimatedCostUsd += costFor(bucket);
    } else {
      groups.set(key, {
        key,
        recordCount: bucket.recordCount,
        totalTokens: tokens,
        share: 0,
        estimatedCostUsd: costFor(bucket),
      });
    }
  }
  const total = [...groups.values()].reduce((sum, item) => sum + item.totalTokens, 0);
  return [...groups.values()]
    .map((item) => ({ ...item, share: total > 0 ? item.totalTokens / total : 0 }))
    .sort((left, right) => right.totalTokens - left.totalTokens || left.key.localeCompare(right.key));
};
const inRange = (timestamp: number, from: number, to: number): boolean =>
  timestamp >= from && timestamp < to;

export class ProjectInsightService {
  constructor(private readonly repository: UsageRepository) {}

  async get(
    projectKey: string,
    range: ProjectInsightRange = "last30",
    now = Date.now(),
  ): Promise<ProjectInsight | undefined> {
    const [storedBuckets, records] = await Promise.all([
      this.repository.getBuckets({ projectKey }),
      this.repository.getRecords({ projectKey }),
    ]);
    const buckets = storedBuckets.length ? storedBuckets : aggregateBuckets(records);
    if (!buckets.length && !records.length) return undefined;

    const today = startOfLocalDay(now);
    const firstActiveAt = records.reduce<number | undefined>(
      (min, record) => Math.min(min ?? record.timestamp, record.timestamp),
      undefined,
    );
    const lastActiveAt = records.reduce<number | undefined>(
      (max, record) => Math.max(max ?? record.timestamp, record.timestamp),
      undefined,
    );
    const allTimeUsage = sumRecords(records);
    const allTime: ProjectAllTimeSummary = {
      firstActiveAt,
      lastActiveAt,
      recordCount: records.length,
      sessionCount: sessionCount(records),
      usage: allTimeUsage,
      totalTokens: totalTokens(allTimeUsage),
    };

    const span = daysFor(range);
    const from = span === undefined
      ? startOfLocalDay(firstActiveAt ?? today)
      : addLocalDays(today, -(span - 1));
    const to = addLocalDays(today, 1);
    const rangeBuckets = buckets.filter((bucket) => inRange(bucket.bucketStart, from, to));
    const rangeRecords = records.filter((record) => inRange(record.timestamp, from, to));
    const rangeUsage = sumBuckets(rangeBuckets);
    const rangeTotalTokens = totalTokens(rangeUsage);
    const rangeShare = cachedInputShare(rangeUsage);
    const trend: ProjectTrendPoint[] = [];
    for (let timestamp = from; timestamp < to; timestamp = addLocalDays(timestamp, 1)) {
      const dayBuckets = rangeBuckets.filter((bucket) => startOfLocalDay(bucket.bucketStart) === timestamp);
      const dayUsage = sumBuckets(dayBuckets);
      trend.push({
        day: localDayKey(timestamp),
        timestamp,
        usage: dayUsage,
        totalTokens: totalTokens(dayUsage),
        estimatedCostUsd: dayBuckets.reduce((sum, bucket) => sum + costFor(bucket), 0),
      });
    }

    let comparison: ProjectPeriodSummary | undefined;
    if (span !== undefined) {
      const previousFrom = addLocalDays(from, -span);
      const previousTokens = buckets.reduce(
        (sum, bucket) => sum + (inRange(bucket.bucketStart, previousFrom, from) ? totalTokens(bucket.usage) : 0),
        0,
      );
      const deltaTokens = rangeTotalTokens - previousTokens;
      comparison = {
        from,
        to,
        currentTokens: rangeTotalTokens,
        previousTokens,
        deltaTokens,
        ...(previousTokens > 0 ? { changePercent: (deltaTokens / previousTokens) * 100 } : {}),
      };
    }

    const sessionService = new SessionUsageService(this.repository);
    const rangeInsight: ProjectRangeInsight = {
      range,
      from,
      to,
      recordCount: rangeRecords.length,
      sessionCount: sessionCount(rangeRecords),
      usage: rangeUsage,
      totalTokens: rangeTotalTokens,
      ...(rangeShare === undefined ? {} : { cachedInputShare: rangeShare }),
      pricing: pricingCoverageForBuckets(rangeBuckets),
      ...(comparison ? { comparison } : {}),
      trend,
      bySource: breakdown(rangeBuckets, (bucket) => bucket.source),
      byModel: breakdown(rangeBuckets, (bucket) => bucket.model),
      topSessions: await sessionService.topForProject(projectKey, { from, to }),
    };
    return { projectKey, allTime, range: rangeInsight };
  }
}
