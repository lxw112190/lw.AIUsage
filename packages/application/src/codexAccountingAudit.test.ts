import { describe, expect, it } from "vitest";
import { createFixturePlatform } from "@lw-aiusage/platform";
import { MemoryUsageRepository } from "@lw-aiusage/storage";
import { CodexAccountingAuditService, compareRecords, resolveCollectorLogicalId } from "./codexAccountingAudit";

describe("Codex accounting audit", () => {
  it("reconciles the raw v4-equivalent with stored Codex records", async () => {
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/a.jsonl": `${JSON.stringify({ type: "session_meta", payload: { id: "a", model: "gpt-5" } })}\n${JSON.stringify({ type: "token_count", payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 12 } } } })}\n`,
    });
    const repository = new MemoryUsageRepository();
    const service = new CodexAccountingAuditService(platform, repository);
    const report = await service.audit();
    expect(report.auditVersion).toBe(3);
    expect(report.auditRevision).toBe(9);
    expect(report.snapshot.sourceStable).toBe(true);
    expect(report.snapshot.databaseStable).toBe(true);
    expect(report.snapshot.auditStable).toBe(true);
    expect(report.snapshotStable).toBe(true);
    expect(report.raw.methods.parserEquivalentV4AllEvents.inputTokens).toBe(12);
    expect(report.v5MigrationValidation.comparison.v4.totalTokens).toBe(12);
    expect(report.v5MigrationValidation.comparison.v5.canonicalTokens).toBe(12);
    expect("comparisonEntries" in report.v5MigrationValidation.comparison).toBe(false);
    expect(report.v5MigrationValidation.comparison.details).toBeDefined();
    expect(report.v5MigrationValidation.comparison.attribution).toBeDefined();
    expect(report.database.totalTokens).toBe(0);
    expect(report.reconciliation.differenceTokens).toBe(12);
    expect(report.reconciliation.matched).toBe(false);
  });

  it("keeps V5 migration ready when the stable old database does not match the V4 mirror", async () => {
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/a.jsonl": [
        JSON.stringify({ type: "session_meta", payload: { id: "a", model: "gpt-5" } }),
        JSON.stringify({ type: "token_count", timestamp: 1_000, payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 12 } } } }),
      ].join("\n") + "\n",
    });
    const repository = new MemoryUsageRepository();
    await repository.putRecords([{
      id: "stale-record",
      source: "codex",
      timestamp: 1_000,
      model: "gpt-5",
      projectKey: "unknown",
      usage: { inputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
    }]);

    const report = await new CodexAccountingAuditService(platform, repository).audit();

    expect(report.snapshot.sourceStable).toBe(true);
    expect(report.snapshot.databaseStable).toBe(true);
    expect(report.snapshot.auditStable).toBe(true);
    expect(report.reconciliation.matched).toBe(false);
    expect(report.v5MigrationValidation.comparatorReady).toBe(true);
    expect(report.v5MigrationValidation.readyForCollectorSwitch).toBe(true);
  });

  it("does not override a blocked comparator when the source snapshot is stable", async () => {
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/a.jsonl": `${JSON.stringify({ type: "session_meta", payload: { id: "a", model: "gpt-5" } })}\n${JSON.stringify({ type: "token_count", payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 12 } } } })}\n`,
    });
    const report = await new CodexAccountingAuditService(platform, new MemoryUsageRepository()).audit();

    expect(report.v5MigrationValidation.sourceSnapshotStable).toBe(true);
    expect(report.v5MigrationValidation.comparatorReady).toBe(false);
    expect(report.v5MigrationValidation.readyForCollectorSwitch).toBe(false);
  });

  it("rejects a reconciliation when token components differ despite equal total", async () => {
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/a.jsonl": `${JSON.stringify({ type: "token_count", payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 12 } } } })}\n`,
    });
    const repository = new MemoryUsageRepository();
    await repository.putRecords([{
      id: "stored",
      source: "codex",
      timestamp: 1,
      model: "gpt-5",
      projectKey: "unknown",
      usage: { inputTokens: 11, cachedInputTokens: 1, cacheCreationInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
    }]);

    const report = await new CodexAccountingAuditService(platform, repository).audit();

    expect(report.reconciliation.differenceTokens).toBe(0);
    expect(report.reconciliation.tokenMatched).toBe(true);
    expect(report.reconciliation.usageComponentsMatched).toBe(false);
    expect(report.reconciliation.matched).toBe(false);
  });

  it("uses cursor parser state session id as the Collector logical id fallback", () => {
    expect(resolveCollectorLogicalId({ parserState: { sessionId: "session-A" } }, undefined)).toBe("session-A");
    expect(resolveCollectorLogicalId({ logicalId: "logical-A", parserState: { sessionId: "session-A" } }, "snapshot-A")).toBe("logical-A");
  });

  it("detects record identity and content mismatches separately", () => {
    const mirror = [{ id: "A", sessionId: "s", timestamp: 1, model: "gpt-5", projectKey: "p", sourceKind: "token-count" as const, usage: { inputTokens: 100, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 } }];
    const database = [{ id: "A", sessionId: "s", timestamp: 2, model: "gpt-5", projectKey: "p", usage: { inputTokens: 0, cachedInputTokens: 100, cacheCreationInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 } }];
    const content = compareRecords(mirror, database);
    expect(content.recordIdentityMatched).toBe(true);
    expect(content.recordContentMatched).toBe(false);
    expect(content.mismatches.contentMismatch).toBe(1);

    const identity = compareRecords(mirror, [{ ...database[0]!, id: "B", usage: mirror[0]!.usage }]);
    expect(identity.recordIdentityMatched).toBe(false);
    expect(identity.mismatches.mirrorOnly).toBe(1);
    expect(identity.mismatches.databaseOnly).toBe(1);
  });
});
