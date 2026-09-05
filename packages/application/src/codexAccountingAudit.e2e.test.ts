import { describe, expect, it } from "vitest";
import { CodexCollector } from "@lw-aiusage/collectors";
import { createFixturePlatform } from "@lw-aiusage/platform";
import { MemoryUsageRepository } from "@lw-aiusage/storage";
import { SyncManager } from "./sync";
import { CodexAccountingAuditService } from "./codexAccountingAudit";

const tokenCount = (payload: Record<string, unknown>, uuid?: string): string => JSON.stringify({ type: "token_count", ...(uuid ? { uuid } : {}), payload });

describe("Codex accounting audit end to end", () => {
  it("matches the real v4 collector path including sources, duplicates, missing models and fork", async () => {
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/a-parent.jsonl": [
        JSON.stringify({ type: "session_meta", payload: { id: "parent", model: "gpt-5" } }),
        tokenCount({ model: "gpt-5", info: { total_token_usage: { input_tokens: 1_000 }, last_token_usage: { input_tokens: 1_000 } } }),
        tokenCount({ model: "gpt-5", info: { total_token_usage: { input_tokens: 2_000 }, last_token_usage: { input_tokens: 1_000 } } }),
      ].join("\n") + "\n",
      "/fixture/.codex/sessions/m-sources.jsonl": [
        JSON.stringify({ type: "session_meta", payload: { id: "sources", model: "gpt-5" } }),
        tokenCount({ model: "gpt-5", info: { last_token_usage: { input_tokens: 10 } } }, "duplicate"),
        tokenCount({ model: "gpt-5", info: { last_token_usage: { input_tokens: 12 } } }, "duplicate"),
        JSON.stringify({ type: "response.completed", payload: { model: "gpt-5", usage: { input_tokens: 20 } } }),
        JSON.stringify({ type: "response.completed", payload: { model: "gpt-5", input_tokens: 30 } }),
        JSON.stringify({ type: "response.completed", payload: { usage: { input_tokens: 999 } } }),
      ].join("\n") + "\n",
      "/fixture/.codex/sessions/z-child.jsonl": [
        JSON.stringify({ type: "session_meta", payload: { id: "child", forked_from_id: "parent", model: "gpt-5" } }),
        tokenCount({ model: "gpt-5", info: { total_token_usage: { input_tokens: 2_200 }, last_token_usage: { input_tokens: 200 } } }),
      ].join("\n") + "\n",
      "/fixture/.codex/sessions/n-missing.jsonl": `${JSON.stringify({ type: "response.completed", payload: { usage: { input_tokens: 999 } } })}\n`,
    });
    const repository = new MemoryUsageRepository();
    const manager = new SyncManager(platform, repository, [new CodexCollector()]);
    await manager.sync();
    const report = await new CodexAccountingAuditService(platform, repository).audit();
    expect(report.snapshotStable).toBe(true);
    expect(report.reconciliation.differenceTokens).toBe(0);
    expect(report.reconciliation.usageComponentsMatched).toBe(true);
    expect(report.reconciliation.recordIdentityMatched).toBe(true);
    expect(report.reconciliation.recordContentMatched).toBe(true);
    expect(report.reconciliation.recordCountMatched).toBe(true);
    expect(report.reconciliation.sessionCountMatched).toBe(true);
    expect(report.reconciliation.matched).toBe(true);
    expect(report.raw.methods.parserEquivalentV4UniqueRecordCount).toBe(report.database.recordCount);
    expect(report.raw.usageSources.payloadUsage.events).toBe(3);
    expect(report.raw.usageSources.flatPayloadUsage.events).toBe(1);
    expect(report.raw.usageSources.ignoredNoModel.events).toBe(1);
  });
});
