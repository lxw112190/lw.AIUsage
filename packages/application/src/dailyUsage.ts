import { localDayKey, startOfLocalDay, totalTokens, type UsageBucket } from "@lw-aiusage/core";

export interface DailyUsagePoint {
  day: string;
  timestamp: number;
  totalTokens: number;
  recordCount: number;
  /** Sum of bucket session counts; this is not guaranteed to be unique. */
  sessionCount: number;
}

export function dailyUsageFromBuckets(buckets: readonly UsageBucket[]): DailyUsagePoint[] {
  const points = new Map<string, DailyUsagePoint>();
  for (const bucket of buckets) {
    const timestamp = startOfLocalDay(bucket.bucketStart);
    const day = localDayKey(timestamp);
    const point = points.get(day) ?? { day, timestamp, totalTokens: 0, recordCount: 0, sessionCount: 0 };
    point.totalTokens += totalTokens(bucket.usage);
    point.recordCount += bucket.recordCount;
    point.sessionCount += bucket.sessionCount;
    points.set(day, point);
  }
  return [...points.values()].sort((left, right) => left.timestamp - right.timestamp);
}
