import { describe, expect, it } from "vitest";
import { MemoryUsageRepository } from "@lw-aiusage/storage";
import { ChangeDriverService } from "./changeDrivers";

const bucket = (id: string, timestamp: number, projectKey: string, tokens: number) => ({ id, bucketStart: timestamp, source: "codex" as const, model: "gpt-5", projectKey, usage: { inputTokens: tokens, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 }, recordCount: 1, sessionCount: 1 });
describe("change drivers", () => {
  it("reports increased, inactive and new projects using the same comparable window", async () => {
    const now = new Date(2026, 8, 10, 12).getTime();
    const repository = new MemoryUsageRepository();
    await repository.putBuckets([
      bucket("previous-a", new Date(2026, 8, 9, 10).getTime(), "keep", 10),
      bucket("previous-b", new Date(2026, 8, 9, 10).getTime(), "inactive", 20),
      bucket("current-a", new Date(2026, 8, 10, 10).getTime(), "keep", 25),
      bucket("current-c", new Date(2026, 8, 10, 10).getTime(), "new", 30),
    ]);
    const result = await new ChangeDriverService(repository).get("today", now);
    expect(result.currentTokens).toBe(55);
    expect(result.previousTokens).toBe(30);
    expect(result.byProject.find((item) => item.key === "keep")).toMatchObject({ deltaTokens: 15, state: "increased" });
    expect(result.byProject.find((item) => item.key === "inactive")).toMatchObject({ deltaTokens: -20, state: "inactive" });
    expect(result.byProject.find((item) => item.key === "new")).toMatchObject({ deltaTokens: 30, state: "new" });
  });
});
