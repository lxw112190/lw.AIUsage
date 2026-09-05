import { describe, expect, it } from "vitest";
import { createFixturePlatform } from "@lw-aiusage/platform";
import { MemoryUsageRepository } from "@lw-aiusage/storage";
import { CodexAccountingAuditService } from "./codexAccountingAudit";

describe("Codex accounting audit", () => {
  it("reconciles the raw v4-equivalent with stored Codex records", async () => {
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/a.jsonl": `${JSON.stringify({ type: "token_count", payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 12 } } } })}\n`,
    });
    const repository = new MemoryUsageRepository();
    const service = new CodexAccountingAuditService(platform, repository);
    const report = await service.audit();
    expect(report.auditVersion).toBe(3);
    expect(report.raw.methods.parserEquivalentV4AllEvents.inputTokens).toBe(12);
    expect(report.database.totalTokens).toBe(0);
    expect(report.reconciliation.differenceTokens).toBe(12);
    expect(report.reconciliation.matched).toBe(false);
  });
});
