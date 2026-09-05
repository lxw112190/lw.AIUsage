import { describe, expect, it } from "vitest";
import { aggregateBuckets, totalTokens, type UsageRecord } from "./index";
const record = (id: string, timestamp: number): UsageRecord => ({ id, source: "codex", timestamp, model: "gpt-5", projectKey: "demo", sessionId: "session", usage: { inputTokens: 10, cachedInputTokens: 2, cacheCreationInputTokens: 0, outputTokens: 5, reasoningOutputTokens: 1 } });
describe("core aggregation", () => { it("calculates total and 30 minute buckets", () => { const records = [record("a", 0), record("b", 1_000)]; expect(totalTokens(records[0]!.usage)).toBe(18); expect(aggregateBuckets(records)).toHaveLength(1); expect(aggregateBuckets(records)[0]?.recordCount).toBe(2); }); });
