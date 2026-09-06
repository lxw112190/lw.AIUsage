import { describe, expect, it } from "vitest";
import { CodexCollector } from "@lw-aiusage/collectors";
import { createFixturePlatform, type RuntimePlatform } from "@lw-aiusage/platform";
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
    expect(report.auditRevision).toBe(13);
    expect(report.parserVersion).toBe(4);
    expect(report.snapshot.sourceStable).toBe(true);
    expect(report.snapshot.databaseStable).toBe(true);
    expect(report.snapshot.auditStable).toBe(true);
    expect(report.v5MigrationValidation.sourceSnapshotStable).toBe(true);
    expect(report.v5MigrationValidation.snapshotStable).toBe(true);
    expect(report.v5MigrationValidation.comparison.v4.totalTokens).toBeGreaterThan(0);
    expect(report.v5MigrationValidation.comparison.v5.canonicalTokens).toBeGreaterThan(0);
    expect(report.eventTaxonomy.tokenCountEvents).toBeGreaterThan(0);
    expect(report.payloadUsageOverlap.payloadTokenInvariant).toBe(true);
    expect(report.payloadUsageOverlap.payloadUniverseEventInvariant).toBe(true);
    expect(report.payloadUsageOverlap.payloadUniverseTokenInvariant).toBe(true);
    expect(report.payloadUsageOverlap.payloadEventInvariant).toBe(true);
    expect(report.payloadUsageOverlap.payloadClassificationInvariant).toBe(true);
    expect(report.payloadUsageOverlap.payloadClassificationInvariant).toBe(
      report.payloadUsageOverlap.payloadTokenInvariant && report.payloadUsageOverlap.payloadEventInvariant,
    );
    expect(report.forkHistory.forkMirrorOnlyInvariant).toBe(true);
  });

  it("blocks migration after the source snapshot changes during the audit window", async () => {
    const base = createFixturePlatform({
      "/fixture/.codex/sessions/a.jsonl": [
        JSON.stringify({ type: "session_meta", payload: { id: "a", model: "gpt-5" } }),
        tokenCount({ model: "gpt-5", info: { last_token_usage: { input_tokens: 12 } } }, "a"),
      ].join("\n") + "\n",
    });
    let sessionListCalls = 0;
    const fileSystem = Object.create(base.fs) as RuntimePlatform["fs"];
    fileSystem.list = async (path: string) => {
      const entries = await base.fs.list(path);
      if (path === "/fixture/.codex/sessions") {
        sessionListCalls += 1;
        if (sessionListCalls >= 3) {
          return entries.map((entry) => entry.path.endsWith("a.jsonl") ? { ...entry, modifiedAt: 2 } : entry);
        }
      }
      return entries;
    };
    const platform: RuntimePlatform = {
      ...base,
      fs: fileSystem,
    };

    const report = await new CodexAccountingAuditService(platform, new MemoryUsageRepository()).audit();

    expect(report.snapshot.sourceStable).toBe(false);
    expect(report.v5MigrationValidation.sourceSnapshotStable).toBe(false);
    expect(report.v5MigrationValidation.readyForCollectorSwitch).toBe(false);
    expect(report.v5MigrationValidation.comparison.v4.totalTokens).toBeGreaterThan(0);
  });

  it("prefers fresh session metadata over a stale cursor logical id", async () => {
    const path = "/fixture/.codex/archived_sessions/rollout-child.jsonl";
    const content = [
      JSON.stringify({ type: "session_meta", payload: { id: "child", forked_from_id: "parent", model: "gpt-5" } }),
      tokenCount({ model: "gpt-5", info: { last_token_usage: { input_tokens: 12 } } }, "child-token"),
    ].join("\n") + "\n";
    const platform = createFixturePlatform({ [path]: content });
    const repository = new MemoryUsageRepository();
    const entry = (await platform.fs.list("/fixture/.codex/archived_sessions"))[0]!;
    await repository.putCursor({
      key: `codex:${path}`,
      source: "codex",
      path,
      logicalId: "parent",
      offset: entry.size,
      size: entry.size,
      modifiedAt: entry.modifiedAt,
      pendingText: "",
      parserVersion: 4,
    });

    const report = await new CodexAccountingAuditService(platform, repository).audit();
    const comparison = report.v5MigrationValidation.comparison;

    expect(comparison.conflicts).toEqual([]);
    expect(comparison.v5.diagnostics.decode.sessionIdentityConflicts).toBe(0);
    expect(comparison.v5.diagnostics.reconcile.conflictingLogicalSessions).toBe(0);
  });
});
