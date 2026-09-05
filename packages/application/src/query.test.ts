import { describe, expect, it } from "vitest";
import { MemoryUsageRepository } from "@lw-aiusage/storage";
import { QueryService } from "./query";

describe("QueryService", () => {
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
