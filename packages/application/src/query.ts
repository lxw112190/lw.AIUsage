import {
  estimatedCostUsd,
  pricingForModel,
  totalTokens,
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
  bySource: Record<string, number>;
  bySourceRecords: Record<string, number>;
  trend: DashboardTrendPoint[];
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
  async dashboard(): Promise<DashboardData> {
    const buckets = await this.repository.getBuckets();
    const bySource: Record<string, number> = {};
    const bySourceRecords: Record<string, number> = {};
    let records = 0;
    let tokens = 0;
    let cost = 0;
    for (const bucket of buckets) {
      const bucketTokens = totalTokens(bucket.usage);
      records += bucket.recordCount;
      tokens += bucketTokens;
      bySource[bucket.source] = (bySource[bucket.source] ?? 0) + bucketTokens;
      bySourceRecords[bucket.source] = (bySourceRecords[bucket.source] ?? 0) + bucket.recordCount;
      const pricing = pricingForModel(bucket.model);
      if (pricing) cost += estimatedCostUsd(bucket.usage, pricing);
    }
    return {
      records,
      totalTokens: tokens,
      estimatedCostUsd: cost,
      bySource,
      bySourceRecords,
      trend: dailyUsageFromBuckets(buckets).map(({ day, timestamp, totalTokens }) => ({ day, timestamp, totalTokens })),
    };
  }
  async stats(): Promise<StatsData> {
    const buckets = await this.repository.getBuckets();
    return {
      byModel: bucketGroup(buckets, (bucket) => bucket.model),
      byProject: bucketGroup(buckets, (bucket) => bucket.projectKey),
    };
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
