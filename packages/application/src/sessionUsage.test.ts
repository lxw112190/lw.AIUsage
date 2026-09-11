import { describe, expect, it } from "vitest";
import { MemoryUsageRepository } from "@lw-aiusage/storage";
import { SessionUsageService, aggregateUsageSessions } from "./sessionUsage";

const usage = (inputTokens: number, outputTokens = 0) => ({ inputTokens, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens, reasoningOutputTokens: 0 });
const record = (id: string, source: "codex" | "claude", sessionId: string | undefined, timestamp: number, model: string, projectKey: string, inputTokens: number) => ({ id, source, sessionId, timestamp, model, projectKey, usage: usage(inputTokens, 1) });

describe("session usage explorer", () => {
  it("groups by source and session while preserving unassigned records", () => {
    const result = aggregateUsageSessions([
      record("a", "codex", "s1", 10, "gpt-5", "p1", 10),
      record("b", "codex", "s1", 20, "gpt-5", "p2", 20),
      record("c", "claude", "s1", 30, "claude-sonnet", "p1", 30),
      record("d", "codex", undefined, 40, "gpt-5", "p1", 40),
    ]);
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions.find((item) => item.key === "codex:s1")?.totalTokens).toBe(32);
    expect(result.sessions.find((item) => item.key === "codex:s1")?.projects).toEqual(["p2", "p1"]);
    expect(result.unassigned).toEqual({ recordCount: 1, totalTokens: 41 });
  });

  it("lists and details sessions without mixing agents", async () => {
    const repository = new MemoryUsageRepository();
    await repository.putRecords([
      record("a", "codex", "s1", 10, "gpt-5", "p", 10),
      record("b", "codex", "s1", 20, "gpt-5", "p", 20),
      record("c", "claude", "s1", 30, "claude-sonnet", "p", 100),
    ]);
    const service = new SessionUsageService(repository);
    const list = await service.list({ filters: { source: "codex" }, page: 1, pageSize: 10, order: "tokens" });
    expect(list.total).toBe(1);
    expect(list.items[0]?.sessionId).toBe("s1");
    const detail = await service.detail("codex", "s1");
    expect(detail?.records).toHaveLength(2);
    expect(detail?.timeline).toHaveLength(1);
  });
});
