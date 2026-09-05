import { describe, expect, it } from "vitest";
import type { UsageRecord } from "@lw-aiusage/core";
import { buildUsageAuditReport } from "./usageAudit";

const usage = (inputTokens: number) => ({
  inputTokens,
  cachedInputTokens: 2,
  cacheCreationInputTokens: 3,
  outputTokens: 4,
  reasoningOutputTokens: 5,
});

describe("usage audit", () => {
  it("breaks down totals by source, model and local day", () => {
    const records: UsageRecord[] = [
      { id: "a", source: "codex", sourcePath: "private/path", sessionId: "s1", timestamp: new Date("2026-09-01T10:00:00").getTime(), model: "gpt-5", projectKey: "p", usage: usage(10) },
      { id: "b", source: "codex", sessionId: "s1", timestamp: new Date("2026-09-01T11:00:00").getTime(), model: "gpt-5", projectKey: "p", usage: usage(20) },
      { id: "c", source: "claude", sessionId: "s2", timestamp: new Date("2026-09-02T11:00:00").getTime(), model: "claude-sonnet-4", projectKey: "q", usage: usage(30) },
    ];
    const report = buildUsageAuditReport(records, 123);
    expect(report.generatedAt).toBe(123);
    expect(report.recordCount).toBe(3);
    expect(report.sessionCount).toBe(2);
    expect(report.usage.inputTokens).toBe(60);
    expect(report.totals.currentTotal).toBe(102);
    expect(report.bySource.map((item) => item.source)).toEqual(["claude", "codex"]);
    expect(report.bySource.find((item) => item.source === "codex")?.sessionCount).toBe(1);
    expect(report.byModel.find((item) => item.model === "gpt-5")?.recordCount).toBe(2);
    expect(report.daily.map((item) => item.day)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(report.peakDays[0]?.day).toBe("2026-09-01");
  });
});
