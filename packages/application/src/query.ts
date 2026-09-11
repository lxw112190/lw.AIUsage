import {
  addLocalDays,
  addUsage,
  cachedInputShare,
  estimatedCostUsd,
  pricingForModel,
  startOfLocalDay,
  startOfLocalWeek,
  totalTokens,
  zeroUsage,
  type AgentSource,
  type UsageBucket,
  type UsageRecord,
} from "@lw-aiusage/core";
import type {
  UsagePageQuery,
  UsagePageResult,
  UsageQuery,
  UsageRepository,
} from "@lw-aiusage/storage";
import { ActivityService, type ActivityGranularity, type ActivityViewData } from "./activity";
import { dailyUsageFromBuckets } from "./dailyUsage";

export interface UsageFilters extends UsageQuery {
  source?: AgentSource;
  model?: string;
  projectKey?: string;
}
export interface UsageGroup {
  key: string;
  recordCount: number;
  totalTokens: number;
  estimatedCostUsd: number;
}
export interface UsageReport {
  records: UsageRecord[];
  totalTokens: number;
  estimatedCostUsd: number;
  byModel: UsageGroup[];
  byProject: UsageGroup[];
}
export interface DashboardData {
  records: number;
  totalTokens: number;
  estimatedCostUsd: number;
  usage: UsageRecord["usage"];
  cachedInputShare?: number;
  bySource: Record<string, number>;
  bySourceRecords: Record<string, number>;
  trend: DashboardTrendPoint[];
  periods: PeriodComparison[];
}
export type ComparisonPeriod = "today" | "week" | "month";
export interface PeriodComparison {
  period: ComparisonPeriod;
  currentTokens: number;
  previousTokens: number;
  deltaTokens: number;
  changePercent?: number;
}
export interface DashboardTrendPoint {
  day: string;
  timestamp: number;
  totalTokens: number;
}
export interface StatsData {
  byModel: UsageGroup[];
  byProject: UsageGroup[];
}

export interface AgentUsageSummary {
  source: AgentSource;
  recordCount: number;
  sessionCount: number;
  projectCount: number;
  modelCount: number;
  firstActiveAt?: number;
  lastActiveAt?: number;
  usage: UsageRecord["usage"];
  totalTokens: number;
  estimatedCostUsd: number;
  cachedInputShare?: number;
}

const group = (
  records: readonly UsageRecord[],
  keyOf: (record: UsageRecord) => string,
): UsageGroup[] => {
  const groups = new Map<string, UsageGroup>();
  for (const record of records) {
    const key = keyOf(record);
    const pricing = pricingForModel(record.model);
    const current = groups.get(key);
    const tokens = totalTokens(record.usage);
    const cost = pricing ? estimatedCostUsd(record.usage, pricing) : 0;
    if (current) {
      current.recordCount += 1;
      current.totalTokens += tokens;
      current.estimatedCostUsd += cost;
    } else
      groups.set(key, {
        key,
        recordCount: 1,
        totalTokens: tokens,
        estimatedCostUsd: cost,
      });
  }
  return [...groups.values()].sort(
    (left, right) => right.totalTokens - left.totalTokens,
  );
};

const bucketGroup = (
  buckets: readonly UsageBucket[],
  keyOf: (bucket: UsageBucket) => string,
): UsageGroup[] => {
  const groups = new Map<string, UsageGroup>();
  for (const bucket of buckets) {
    const key = keyOf(bucket);
    const pricing = pricingForModel(bucket.model);
    const current = groups.get(key);
    const tokens = totalTokens(bucket.usage);
    const cost = pricing ? estimatedCostUsd(bucket.usage, pricing) : 0;
    if (current) {
      current.recordCount += bucket.recordCount;
      current.totalTokens += tokens;
      current.estimatedCostUsd += cost;
    } else
      groups.set(key, {
        key,
        recordCount: bucket.recordCount,
        totalTokens: tokens,
        estimatedCostUsd: cost,
      });
  }
  return [...groups.values()].sort(
    (left, right) => right.totalTokens - left.totalTokens,
  );
};

const startOfLocalMonth = (timestamp: number): number => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
};

const previousLocalMonth = (timestamp: number): number => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime();
};

const tokensBetween = (buckets: readonly UsageBucket[], from: number, to: number): number =>
  buckets.reduce((sum, bucket) => sum + (bucket.bucketStart >= from && bucket.bucketStart < to ? totalTokens(bucket.usage) : 0), 0);

export function periodComparisons(buckets: readonly UsageBucket[], now = Date.now()): PeriodComparison[] {
  const day = startOfLocalDay(now);
  const week = startOfLocalWeek(now);
  const month = startOfLocalMonth(now);
  const periods: Array<{ period: ComparisonPeriod; currentStart: number; previousStart: number }> = [
    { period: "today", currentStart: day, previousStart: addLocalDays(day, -1) },
    { period: "week", currentStart: week, previousStart: addLocalDays(week, -7) },
    { period: "month", currentStart: month, previousStart: previousLocalMonth(month) },
  ];
  return periods.map(({ period, currentStart, previousStart }) => {
    const elapsed = Math.max(1, now - currentStart + 1);
    const previousEnd = Math.min(currentStart, previousStart + elapsed);
    const currentTokens = tokensBetween(buckets, currentStart, now + 1);
    const previousTokens = tokensBetween(buckets, previousStart, previousEnd);
    const deltaTokens = currentTokens - previousTokens;
    return {
      period,
      currentTokens,
      previousTokens,
      deltaTokens,
      ...(previousTokens > 0 ? { changePercent: (deltaTokens / previousTokens) * 100 } : {}),
    };
  });
}

export class QueryService {
  constructor(private readonly repository: UsageRepository) {}
  async records(filters: UsageFilters = {}): Promise<UsageRecord[]> {
    return this.repository.getRecords(filters);
  }
  async recordsPage(query: UsagePageQuery): Promise<UsagePageResult> {
    return this.repository.getRecordsPage(query);
  }
  async modelOptions(): Promise<string[]> {
    return this.repository.getModelOptions();
  }
  async projectOptions(): Promise<string[]> {
    return this.repository.getProjectOptions();
  }
  async dashboard(now = Date.now()): Promise<DashboardData> {
    const buckets = await this.repository.getBuckets();
    const bySource: Record<string, number> = {};
    const bySourceRecords: Record<string, number> = {};
    let records = 0;
    let tokens = 0;
    let cost = 0;
    let usage = zeroUsage();
    for (const bucket of buckets) {
      const bucketTokens = totalTokens(bucket.usage);
      records += bucket.recordCount;
      tokens += bucketTokens;
      bySource[bucket.source] = (bySource[bucket.source] ?? 0) + bucketTokens;
      bySourceRecords[bucket.source] = (bySourceRecords[bucket.source] ?? 0) + bucket.recordCount;
      const pricing = pricingForModel(bucket.model);
      if (pricing) cost += estimatedCostUsd(bucket.usage, pricing);
      usage = addUsage(usage, bucket.usage);
    }
    return {
      records,
      totalTokens: tokens,
      estimatedCostUsd: cost,
      usage,
      ...(cachedInputShare(usage) === undefined ? {} : { cachedInputShare: cachedInputShare(usage) }),
      bySource,
      bySourceRecords,
      trend: dailyUsageFromBuckets(buckets).map(({ day, timestamp, totalTokens }) => ({ day, timestamp, totalTokens })),
      periods: periodComparisons(buckets, now),
    };
  }
  async stats(): Promise<StatsData> {
    const buckets = await this.repository.getBuckets();
    return {
      byModel: bucketGroup(buckets, (bucket) => bucket.model),
      byProject: bucketGroup(buckets, (bucket) => bucket.projectKey),
    };
  }
  async agentSummaries(): Promise<AgentUsageSummary[]> {
    const records = await this.repository.getRecords();
    const grouped = new Map<AgentSource, AgentUsageSummary>();
    for (const record of records) {
      const current = grouped.get(record.source);
      const pricing = pricingForModel(record.model);
      if (current) {
        current.recordCount += 1;
        current.usage = addUsage(current.usage, record.usage);
        current.totalTokens += totalTokens(record.usage);
        current.estimatedCostUsd += pricing ? estimatedCostUsd(record.usage, pricing) : 0;
        current.firstActiveAt = Math.min(current.firstActiveAt ?? record.timestamp, record.timestamp);
        current.lastActiveAt = Math.max(current.lastActiveAt ?? record.timestamp, record.timestamp);
      } else {
        grouped.set(record.source, {
          source: record.source,
          recordCount: 1,
          sessionCount: 0,
          projectCount: 0,
          modelCount: 0,
          firstActiveAt: record.timestamp,
          lastActiveAt: record.timestamp,
          usage: addUsage(zeroUsage(), record.usage),
          totalTokens: totalTokens(record.usage),
          estimatedCostUsd: pricing ? estimatedCostUsd(record.usage, pricing) : 0,
        });
      }
    }
    for (const summary of grouped.values()) {
      const sourceRecords = records.filter((record) => record.source === summary.source);
      summary.sessionCount = new Set(sourceRecords.flatMap((record) => record.sessionId ? [record.sessionId] : [])).size;
      summary.projectCount = new Set(sourceRecords.map((record) => record.projectKey)).size;
      summary.modelCount = new Set(sourceRecords.map((record) => record.model)).size;
      const share = cachedInputShare(summary.usage);
      if (share !== undefined) summary.cachedInputShare = share;
    }
    return [...grouped.values()].sort((left, right) => right.totalTokens - left.totalTokens);
  }
  async activity(granularity: ActivityGranularity): Promise<ActivityViewData> {
    return new ActivityService(this.repository).activity(granularity);
  }
  async report(filters: UsageFilters = {}): Promise<UsageReport> {
    const records = await this.records(filters);
    const cost = records.reduce((sum, record) => {
      const pricing = pricingForModel(record.model);
      return sum + (pricing ? estimatedCostUsd(record.usage, pricing) : 0);
    }, 0);
    return {
      records,
      totalTokens: records.reduce(
        (sum, record) => sum + totalTokens(record.usage),
        0,
      ),
      estimatedCostUsd: cost,
      byModel: group(records, (record) => record.model),
      byProject: group(records, (record) => record.projectKey),
    };
  }
}
