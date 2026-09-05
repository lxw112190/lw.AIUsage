import { describe, expect, it } from "vitest";
import { buildActivityView, type DailyPoint } from "./activity";

const localDay = (year: number, month: number, date: number): number =>
  new Date(year, month - 1, date).getTime();
const localKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const point = (timestamp: number, totalTokens: number): DailyPoint => ({
  day: localKey(timestamp),
  timestamp,
  totalTokens,
  recordCount: 1,
  sessionCount: 1,
});

describe("token activity", () => {
  const now = localDay(2026, 9, 4);
  const daily = [
    point(localDay(2026, 8, 31), 10),
    point(localDay(2026, 9, 1), 20),
    point(localDay(2026, 9, 3), 30),
    point(localDay(2026, 9, 4), 5),
  ];

  it.each([
    ["daily", 371, 7, 53],
    ["weekly", 52, 4, 13],
    ["monthly", 12, 2, 6],
    ["cumulative", 371, 7, 53],
  ] as const)("builds the %s activity grid", (granularity, cellCount, rows, columns) => {
    const view = buildActivityView(daily, granularity, now);
    expect(view.cells).toHaveLength(cellCount);
    expect(view.rows).toBe(rows);
    expect(view.columns).toBe(columns);
    expect(view.summary.totalTokens).toBe(65);
  });

  it("aggregates weekly and monthly cells while retaining active-day counts", () => {
    const weekly = buildActivityView(daily, "weekly", now);
    const week = weekly.cells.find((cell) => cell.key === "2026-08-31");
    expect(week?.totalTokens).toBe(65);
    expect(week?.activeDays).toBe(4);

    const monthly = buildActivityView(daily, "monthly", now);
    const august = monthly.cells.find((cell) => cell.key === "2026-08-01");
    const september = monthly.cells.find((cell) => cell.key === "2026-09-01");
    expect(august?.totalTokens).toBe(10);
    expect(september?.totalTokens).toBe(55);
  });

  it("calculates streaks from calendar-consecutive active days", () => {
    const view = buildActivityView(daily, "daily", now);
    expect(view.summary.currentStreakDays).toBe(2);
    expect(view.summary.longestStreakDays).toBe(2);
    expect(view.summary.peakTokens).toBe(30);
  });

  it("exposes a running value for cumulative mode", () => {
    const view = buildActivityView(daily, "cumulative", now);
    expect(view.cells.find((cell) => cell.key === "2026-08-31")?.cumulativeTokens).toBe(10);
    expect(view.cells.find((cell) => cell.key === "2026-09-01")?.cumulativeTokens).toBe(30);
    expect(view.cells.find((cell) => cell.key === "2026-09-03")?.cumulativeTokens).toBe(60);
    expect(view.cells.find((cell) => cell.key === "2026-09-04")?.cumulativeTokens).toBe(65);
  });
});
