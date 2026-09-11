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
    expect(result?.trend).toHaveLength(30);
    expect(result?.trend[1]?.totalTokens).toBe(0);
    expect(result?.bySource.map((item) => item.key)).toEqual(["claude", "codex"]);
    expect(result?.topSessions[0]?.sessionId).toBe("s2");
    expect(result?.cachedInputShare).toBeGreaterThan(0);
  });
});
