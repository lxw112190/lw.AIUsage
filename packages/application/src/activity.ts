import { addLocalDays, localDayKey, startOfLocalDay, startOfLocalWeek } from "@lw-aiusage/core";
import type { UsageRepository } from "@lw-aiusage/storage";
import { dailyUsageFromBuckets, type DailyUsagePoint } from "./dailyUsage";

export type ActivityGranularity = "daily" | "weekly" | "monthly" | "cumulative";
export type DailyPoint = DailyUsagePoint;
export interface ActivityCell {
  key: string;
  start: number;
  end: number;
  label: string;
  totalTokens: number;
  recordCount: number;
  /** Sum of bucket session counts; not guaranteed to be unique across the interval. */
  sessionCount: number;
  activeDays?: number;
  cumulativeTokens?: number;
  intensity: 0 | 1 | 2 | 3 | 4;
}
export interface ActivitySummary {
  allTimeTokens: number;
  rangeTokens: number;
  peakIntervalTokens: number;
  peakLabel: string;
  currentStreakDays: number;
  longestStreakDays: number;
  longestSessionDurationMinutes?: number;
}
export interface ActivityMonthLabel {
  label: string;
  columnStart: number;
}
export interface ActivityViewData {
  granularity: ActivityGranularity;
  rangeStart: number;
  rangeEnd: number;
  rows: number;
  columns: number;
  cells: ActivityCell[];
  monthLabels: ActivityMonthLabel[];
  summary: ActivitySummary;
}

const dayStart = startOfLocalDay;
const dayKey = localDayKey;
const weekStart = startOfLocalWeek;
const monthStart = (timestamp: number): number => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
};
const nextMonth = (timestamp: number): number => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
};
const addDays = addLocalDays;
const emptyPoint = (timestamp: number): DailyPoint => ({ day: dayKey(timestamp), timestamp, totalTokens: 0, recordCount: 0, sessionCount: 0 });
const addPoint = (target: DailyPoint, source: DailyPoint): void => {
  target.totalTokens += source.totalTokens;
  target.recordCount += source.recordCount;
  target.sessionCount += source.sessionCount;
};
const intensityFor = (values: readonly number[], value: number, cumulative = false): 0 | 1 | 2 | 3 | 4 => {
  if (value <= 0) return 0;
  if (cumulative) return Math.min(4, Math.max(1, Math.ceil((value / Math.max(...values)) * 4))) as 1 | 2 | 3 | 4;
  const sorted = [...values].filter((item) => item > 0).sort((left, right) => left - right);
  const rank = sorted.findIndex((item) => item >= value);
  return Math.min(4, Math.floor(((rank < 0 ? sorted.length - 1 : rank) / Math.max(sorted.length - 1, 1)) * 4) + 1) as 1 | 2 | 3 | 4;
};
const summaryFor = (daily: readonly DailyPoint[], cells: readonly ActivityCell[], now: number): ActivitySummary => {
  const allTime = daily.reduce((sum, point) => sum + point.totalTokens, 0);
  const range = cells.reduce((sum, cell) => sum + cell.totalTokens, 0);
  let current = 0;
  const today = dayStart(now);
  const byDay = new Map(daily.map((point) => [point.timestamp, point.totalTokens]));
  for (let timestamp = today; (byDay.get(timestamp) ?? 0) > 0; timestamp = addDays(timestamp, -1)) current += 1;
  let longest = 0;
  let streak = 0;
  let previousActiveTimestamp: number | undefined;
  for (const point of daily) {
    if (point.totalTokens > 0) {
      streak = previousActiveTimestamp !== undefined && point.timestamp === addDays(previousActiveTimestamp, 1) ? streak + 1 : 1;
      previousActiveTimestamp = point.timestamp;
      longest = Math.max(longest, streak);
    } else {
      streak = 0;
      previousActiveTimestamp = undefined;
    }
  }
  const peak = [...cells].sort((left, right) => right.totalTokens - left.totalTokens)[0];
  return { allTimeTokens: allTime, rangeTokens: range, peakIntervalTokens: peak?.totalTokens ?? 0, peakLabel: peak?.label ?? "", currentStreakDays: current, longestStreakDays: longest };
};
function fillDays(points: readonly DailyPoint[], start: number, end: number): DailyPoint[] {
  const byDay = new Map(points.map((point) => [point.day, point]));
  const result: DailyPoint[] = [];
  for (let timestamp = start; timestamp < end; timestamp = addDays(timestamp, 1)) result.push(byDay.get(dayKey(timestamp)) ?? emptyPoint(timestamp));
  return result;
}
function monthLabels(cells: readonly ActivityCell[], columns: number): ActivityMonthLabel[] {
  const labels: ActivityMonthLabel[] = [];
  let previous = "";
  for (let column = 0; column < columns; column += 1) {
    const cell = cells[column * (cells.length / columns)];
    if (!cell) continue;
    const label = `${new Date(cell.start).getFullYear()}-${String(new Date(cell.start).getMonth() + 1).padStart(2, "0")}`;
    if (label !== previous) { labels.push({ label, columnStart: column }); previous = label; }
  }
  return labels;
}

export function buildActivityView(daily: readonly DailyPoint[], granularity: ActivityGranularity, now = Date.now()): ActivityViewData {
  const todayWeekEnd = addDays(weekStart(now), 7);
  let points: DailyPoint[];
  let rows: number;
  let columns: number;
  let rangeStart: number;
  let rangeEnd: number;
  if (granularity === "weekly") {
    columns = 13; rows = 4; rangeEnd = todayWeekEnd; rangeStart = addDays(rangeEnd, -columns * rows * 7);
    const dailyRange = fillDays(daily, rangeStart, rangeEnd);
    points = Array.from({ length: columns * rows }, (_, index) => {
      const start = addDays(rangeStart, index * 7);
      const result = emptyPoint(start);
      for (const point of dailyRange.slice(index * 7, index * 7 + 7)) addPoint(result, point);
      return result;
    });
  } else if (granularity === "monthly") {
    columns = 6; rows = 2;
    const endDate = new Date(monthStart(now));
    rangeEnd = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 1).getTime();
    rangeStart = new Date(endDate.getFullYear(), endDate.getMonth() - columns * rows + 1, 1).getTime();
    const dailyRange = fillDays(daily, rangeStart, rangeEnd);
    points = [];
    for (let timestamp = rangeStart; timestamp < rangeEnd; timestamp = nextMonth(timestamp)) {
      const result = emptyPoint(timestamp);
      const end = nextMonth(timestamp);
      for (const point of dailyRange) if (point.timestamp >= timestamp && point.timestamp < end) addPoint(result, point);
      points.push(result);
    }
  } else if (granularity === "daily") {
    columns = 53; rows = 7; rangeEnd = todayWeekEnd; rangeStart = addDays(rangeEnd, -columns * rows);
    points = fillDays(daily, rangeStart, rangeEnd);
  } else {
    const firstActive = daily.find((point) => point.totalTokens > 0);
    rangeStart = firstActive?.timestamp ?? dayStart(now);
    rangeEnd = addDays(dayStart(now), 1);
    points = fillDays(daily, rangeStart, rangeEnd);
    rows = 1;
    columns = points.length;
  }
  const cumulative = granularity === "cumulative";
  let running = 0;
  const values = points.map((point) => point.totalTokens);
  const cells = points.map((point) => {
    const start = point.timestamp;
    const end = granularity === "weekly" ? addDays(start, 7) : granularity === "monthly" ? nextMonth(start) : addDays(start, 1);
    if (cumulative) running += point.totalTokens;
    const display = cumulative ? running : point.totalTokens;
    return { key: point.day, start, end, label: point.day, totalTokens: point.totalTokens, recordCount: point.recordCount, sessionCount: point.sessionCount, ...(granularity === "weekly" || granularity === "monthly" ? { activeDays: 0 } : {}), ...(cumulative ? { cumulativeTokens: running } : {}), intensity: intensityFor(values, display, cumulative) };
  });
  if (granularity === "weekly" || granularity === "monthly") {
    for (const cell of cells) cell.activeDays = fillDays(daily, cell.start, cell.end).filter((point) => point.totalTokens > 0).length;
  }
  return { granularity, rangeStart, rangeEnd, rows, columns, cells, monthLabels: monthLabels(cells, columns), summary: summaryFor(daily, cells, now) };
}

export class ActivityService {
  constructor(private readonly repository: UsageRepository) {}
  async activity(granularity: ActivityGranularity): Promise<ActivityViewData> {
    return buildActivityView(dailyUsageFromBuckets(await this.repository.getBuckets()), granularity);
  }
}
