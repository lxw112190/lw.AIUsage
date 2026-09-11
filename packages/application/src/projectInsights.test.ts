import { describe, expect, it } from "vitest";
import { MemoryUsageRepository } from "@lw-aiusage/storage";
import { ProjectInsightService } from "./projectInsights";

const usage = (inputTokens: number, cachedInputTokens = 0) => ({ inputTokens, cachedInputTokens, cacheCreationInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0 });
describe("project insights", () => {
  it("fills a fixed local-day trend and keeps raw project identity", async () => {
    const repository = new MemoryUsageRepository();
    const first = new Date(2026, 8, 1, 10).getTime();
    const last = new Date(2026, 8, 3, 10).getTime();
    await repository.putRecords([
      { id: "a", source: "codex", sessionId: "s1", timestamp: first, model: "gpt-5", projectKey: "C:\\Projects\\lw.AIUsage", usage: usage(10, 5) },
      { id: "b", source: "claude", sessionId: "s2", timestamp: last, model: "claude-sonnet-4", projectKey: "C:\\Projects\\lw.AIUsage", usage: usage(20) },
    ]);
    const result = await new ProjectInsightService(repository).get("C:\\Projects\\lw.AIUsage", "last30", new Date(2026, 8, 3, 12).getTime());
    expect(result?.projectKey).toBe("C:\\Projects\\lw.AIUsage");
    expect(result?.range.trend).toHaveLength(30);
    expect(result?.range.trend[1]?.totalTokens).toBe(0);
    expect(result?.range.bySource.map((item) => item.key)).toEqual(["claude", "codex"]);
    expect(result?.range.topSessions[0]?.sessionId).toBe("s2");
    expect(result?.allTime.totalTokens).toBe(37);
    expect(result?.range.cachedInputShare).toBeGreaterThan(0);
    expect(result?.range.topSessions[0]?.sessionId).toBe("s2");
  });

  it("keeps all-time totals stable while applying the selected range to derived metrics", async () => {
    const repository = new MemoryUsageRepository();
    const now = new Date(2026, 8, 30, 12).getTime();
    const old = new Date(2026, 5, 1, 10).getTime();
    const recent = new Date(2026, 8, 29, 10).getTime();
    await repository.putRecords([
      { id: "old", source: "codex", sessionId: "old-session", timestamp: old, model: "gpt-5", projectKey: "demo", usage: usage(100) },
      { id: "recent", source: "codex", sessionId: "recent-session", timestamp: recent, model: "gpt-5", projectKey: "demo", usage: usage(20) },
    ]);
    const service = new ProjectInsightService(repository);
    const last30 = await service.get("demo", "last30", now);
    const all = await service.get("demo", "all", now);
    expect(last30?.allTime.totalTokens).toBe(122);
    expect(last30?.range.totalTokens).toBe(21);
    expect(last30?.range.recordCount).toBe(1);
    expect(last30?.range.topSessions.map((item) => item.sessionId)).toEqual(["recent-session"]);
    expect(all?.allTime.totalTokens).toBe(122);
    expect(all?.range.totalTokens).toBe(122);
    expect(all?.range.comparison).toBeUndefined();
  });
});
