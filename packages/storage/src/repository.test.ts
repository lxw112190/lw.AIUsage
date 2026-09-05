import { describe, expect, it } from "vitest";
import { MemoryUsageRepository, type FileCursor } from "./repository";

describe("repository scan commit", () => {
  it("is safe to repeat after a retry", async () => {
    const repository = new MemoryUsageRepository();
    const record = { id: "r1", source: "codex" as const, timestamp: 1, model: "gpt-5", projectKey: "demo", usage: { inputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0 } };
    const cursor: FileCursor = { key: "codex:file", source: "codex", path: "file", offset: 10, size: 10, modifiedAt: 1, pendingText: "", parserVersion: 1 };
    expect(await repository.commitScan([record], cursor)).toBe(1);
    expect(await repository.commitScan([record], cursor)).toBe(0);
    expect(await repository.getRecords()).toHaveLength(1);
    expect((await repository.getCursors())[0]?.offset).toBe(10);
  });
});
