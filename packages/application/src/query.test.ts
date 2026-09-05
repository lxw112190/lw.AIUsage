import { describe, expect, it } from "vitest";
import { MemoryUsageRepository } from "@lw-aiusage/storage";
import { QueryService } from "./query";

describe("QueryService", () => {
  it("aggregates 30-minute buckets into one local day trend point", async () => {
    const repository = new MemoryUsageRepository();
    const day = new Date("2026-09-01T00:00:00");
    await repository.putBuckets(Array.from({ length: 48 }, (_, index) => ({
      id: `bucket-${index}`,
      bucketStart: day.getTime() + index * 30 * 60 * 1000,
      source: "codex" as const,
      model: "gpt-5",
      projectKey: "demo",
      usage: { inputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
      recordCount: 1,
      sessionCount: 1,
    })));
    const dashboard = await new QueryService(repository).dashboard();
    expect(dashboard.trend).toHaveLength(1);
    expect(dashboard.trend[0]?.day).toBe("2026-09-01");
    expect(dashboard.trend[0]?.totalTokens).toBe(48);
  });

  it("filters records and groups the result by model and project", async () => {
    const repository = new MemoryUsageRepository();
    await repository.putRecords([
      {
        id: "a",
        source: "codex",
        timestamp: 100,
        model: "gpt-5",
        projectKey: "alpha",
        sessionId: "s1",
        usage: {
          inputTokens: 10,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          outputTokens: 5,
          reasoningOutputTokens: 0,
        },
      },
      {
        id: "b",
        source: "claude",
        timestamp: 200,
        model: "claude-sonnet-4",
        projectKey: "beta",
        sessionId: "s2",
        usage: {
          inputTokens: 20,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          outputTokens: 5,
          reasoningOutputTokens: 0,
        },
      },
    ]);
    const report = await new QueryService(repository).report({
      source: "codex",
    });
    expect(report.records).toHaveLength(1);
    expect(report.byModel[0]?.key).toBe("gpt-5");
    expect(report.byProject[0]?.key).toBe("alpha");
  });
});
