import { describe, expect, it } from "vitest";
import { parseCodexFilesV5, type CodexParsedFileInputV5 } from "./parserV5";

const input = (sourcePath: string, values: Record<string, unknown>[], logicalIdHint?: string): CodexParsedFileInputV5 => ({
  sourcePath,
  logicalIdHint,
  values,
});

const sessionMeta = (id: string, timestamp: number | undefined, options: { parent?: string } = {}): Record<string, unknown> => ({
  type: "session_meta",
  ...(timestamp === undefined ? {} : { timestamp }),
  payload: { id, ...(options.parent ? { forked_from_id: options.parent } : {}) },
});

const tokenCount = (
  timestamp: number | undefined,
  usage: Record<string, unknown>,
  options: { responseId?: string; turnId?: string; model?: string; cwd?: string; total?: Record<string, unknown> } = {},
): Record<string, unknown> => ({
  type: "token_count",
  ...(timestamp === undefined ? {} : { timestamp }),
  payload: {
    ...(options.model ? { model: options.model } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.responseId ? { response_id: options.responseId } : {}),
    ...(options.turnId ? { turn_id: options.turnId } : {}),
    info: {
      last_token_usage: usage,
      ...(options.total ? { total_token_usage: options.total } : {}),
    },
  },
});

const payloadUsage = (
  timestamp: number,
  usage: Record<string, unknown>,
  options: { responseId?: string; model?: string; cwd?: string } = {},
): Record<string, unknown> => ({
  type: "response_item",
  timestamp,
  payload: {
    usage,
    ...(options.responseId ? { response_id: options.responseId } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
  },
});

describe("Codex v5 parser pipeline", () => {
  it("decodes and projects a token_count without using a time fallback", () => {
    const result = parseCodexFilesV5([
      input("/sessions/a.jsonl", [sessionMeta("a", 100), tokenCount(110, { input_tokens: 10, output_tokens: 2 }, { model: "gpt-5", cwd: "/repo" })]),
    ]);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ sessionId: "a", timestamp: 110_000, model: "gpt-5", projectKey: "/repo", usage: { inputTokens: 10, outputTokens: 2 } });
    expect(result.records[0]?.id).toMatch(/^codex:v5:a:e1:h[0-9a-f]+:0$/);
    expect(result.safeToActivate).toBe(true);
  });

  it("keeps accounting state moving when an early token has no timestamp", () => {
    const result = parseCodexFilesV5([
      input("/sessions/a.jsonl", [
        sessionMeta("a", 100),
        tokenCount(undefined, {}, { total: { total_tokens: 100 } }),
        tokenCount(110, {}, { total: { total_tokens: 150 } }),
      ]),
    ]);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.usage.inputTokens).toBe(50);
    expect(result.diagnostics.projection.missingTimestampContributions).toBe(1);
    expect(result.diagnostics.projection.missingTimestampTokens).toBe(100);
    expect(result.diagnostics.projection.emittedTokens).toBe(50);
    expect(result.diagnostics.invariants.projectionToken).toBe(true);
    expect(result.diagnostics.activation.timestampCompleteness).toBe(false);
    expect(result.safeToActivate).toBe(false);
  });

  it("does not block activation for an untimestamped non-usage event", () => {
    const result = parseCodexFilesV5([
      input("/sessions/a.jsonl", [
        sessionMeta("a", 100),
        { type: "response_item", payload: { text: "ignored" } },
        tokenCount(110, { input_tokens: 10, output_tokens: 2 }, { model: "gpt-5" }),
      ]),
    ]);

    expect(result.diagnostics.decode.missingTimestampEvents).toBeGreaterThan(0);
    expect(result.diagnostics.activation.timestampCompleteness).toBe(true);
  });

  it("blocks activation when source JSONL has parse errors", () => {
    const result = parseCodexFilesV5([{
      sourcePath: "/sessions/a.jsonl",
      values: [sessionMeta("a", 100), tokenCount(110, { input_tokens: 10, output_tokens: 0 })],
      parseErrors: ["invalid json line"],
    }]);

    expect(result.records).toHaveLength(1);
    expect(result.diagnostics.source).toMatchObject({ files: 1, filesWithParseErrors: 1, parseErrorCount: 1 });
    expect(result.diagnostics.activation.sourceIntegrity).toBe(false);
    expect(result.safeToActivate).toBe(false);
  });

  it("blocks activation when a source file ends with pending JSONL text", () => {
    const result = parseCodexFilesV5([{
      sourcePath: "/sessions/a.jsonl",
      values: [sessionMeta("a", 100)],
      hasPendingText: true,
    }]);

    expect(result.diagnostics.source.filesWithPendingText).toBe(1);
    expect(result.diagnostics.activation.sourceIntegrity).toBe(false);
    expect(result.safeToActivate).toBe(false);
  });

  it("blocks activation when session identity conflicts with the logical hint", () => {
    const result = parseCodexFilesV5([
      input("/sessions/a.jsonl", [sessionMeta("actual", 100), tokenCount(110, { input_tokens: 10, output_tokens: 0 })], "hinted-other-session"),
    ]);

    expect(result.records).toHaveLength(1);
    expect(result.diagnostics.decode.sessionIdentityConflicts).toBe(1);
    expect(result.diagnostics.activation.sessionIdentity).toBe(false);
    expect(result.safeToActivate).toBe(false);
  });

  it("canonicalizes same-event token_count and payload usage only once", () => {
    const result = parseCodexFilesV5([
      input("/sessions/a.jsonl", [
        sessionMeta("a", 100),
        {
          type: "token_count",
          timestamp: 110,
          payload: {
            response_id: "r",
            info: { last_token_usage: { input_tokens: 10, output_tokens: 2 } },
            usage: { input_tokens: 10, output_tokens: 2 },
          },
        },
      ]),
    ]);

    expect(result.records).toHaveLength(1);
    expect(result.diagnostics.payload.confirmedSuppressedEvents).toBe(1);
    expect(result.sessions[0]?.payloadFallbacks).toHaveLength(0);
  });

  it("reports TokenCount duplicate evidence without changing accounting", () => {
    const result = parseCodexFilesV5([
      input("/sessions/a.jsonl", [
        sessionMeta("a", 100),
        tokenCount(110, {}, { total: { input_tokens: 100, output_tokens: 0, total_tokens: 100 } }),
        tokenCount(110, {}, { total: { input_tokens: 100, output_tokens: 0, total_tokens: 100 } }),
      ]),
    ]);

    expect(result.diagnostics.tokenCount.duplicateEvidence.candidatePairs).toBe(1);
    expect(result.diagnostics.tokenCount.duplicateEvidence.confirmedPairs).toBe(1);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.usage.inputTokens).toBe(100);
    expect(result.safeToActivate).toBe(true);
  });

  it("suppresses an exact duplicate before last-usage accounting state advances", () => {
    const result = parseCodexFilesV5([
      input("/sessions/a.jsonl", [
        sessionMeta("a", 100),
        tokenCount(110, { input_tokens: 100, output_tokens: 0 }, { total: { input_tokens: 100, output_tokens: 0, total_tokens: 100 } }),
        tokenCount(120, { input_tokens: 20, output_tokens: 0 }, { total: { input_tokens: 120, output_tokens: 0, total_tokens: 120 } }),
        tokenCount(120, { input_tokens: 20, output_tokens: 0 }, { total: { input_tokens: 120, output_tokens: 0, total_tokens: 120 } }),
        tokenCount(130, { input_tokens: 30, output_tokens: 0 }, { total: { input_tokens: 150, output_tokens: 0, total_tokens: 150 } }),
      ]),
    ]);

    expect(result.diagnostics.tokenCount.suppressedDuplicateEvents).toBe(1);
    expect(result.diagnostics.tokenCount.suppressedDuplicateTokens).toBe(20);
    expect(result.records.reduce((sum, record) => sum + record.usage.inputTokens, 0)).toBe(150);
    expect(result.records).toHaveLength(3);
  });

  it("suppresses a transition-proven semantic duplicate before it can pollute later state", () => {
    const result = parseCodexFilesV5([
      input("/sessions/a.jsonl", [
        sessionMeta("a", 90),
        tokenCount(100, { input_tokens: 100, output_tokens: 0 }, { total: { input_tokens: 100, output_tokens: 0, total_tokens: 100 } }),
        tokenCount(110, { input_tokens: 80, output_tokens: 0 }, { total: { input_tokens: 180, output_tokens: 0, total_tokens: 180 } }),
        tokenCount(110, { input_tokens: 70, output_tokens: 0 }, { total: { input_tokens: 180, output_tokens: 0, total_tokens: 180 } }),
        tokenCount(120, { input_tokens: 20, output_tokens: 0 }, { total: { input_tokens: 200, output_tokens: 0, total_tokens: 200 } }),
      ]),
    ]);

    expect(result.diagnostics.tokenCount).toMatchObject({
      observedEvents: 4,
      canonicalEvents: 3,
      semanticSnapshotDuplicateEvents: 1,
      semanticDuplicateCandidates: 0,
      suppressedDuplicateEvents: 1,
      suppressedDuplicateTokens: 70,
    });
    expect(result.diagnostics.tokenCount.duplicateEvidence).toMatchObject({ resolvedStrongPairs: 1, unresolvedPairs: 0 });
    expect(result.diagnostics.invariants.tokenCountDuplicateEvent).toBe(true);
    expect(result.records).toHaveLength(3);
    expect(result.records.reduce((sum, record) => sum + record.usage.inputTokens, 0)).toBe(200);
  });

  it("keeps a conflicting payload as a second contribution with a distinct slot id", () => {
    const result = parseCodexFilesV5([
      input("/sessions/a.jsonl", [
        sessionMeta("a", 100),
        {
          type: "token_count",
          timestamp: 110,
          payload: {
            info: { last_token_usage: { input_tokens: 10, output_tokens: 2 } },
            usage: { input_tokens: 20, output_tokens: 2 },
          },
        },
      ]),
    ]);

    expect(result.records).toHaveLength(2);
    const ids = result.records.map((record) => record.id);
    expect(ids[0]).toMatch(/^codex:v5:a:e1:h[0-9a-f]+:0$/);
    expect(ids[1]).toMatch(/^codex:v5:a:e1:h[0-9a-f]+:1$/);
    expect(ids[0]).not.toBe(ids[1]);
    expect(result.diagnostics.invariants.uniqueRecordIds).toBe(true);
  });

  it("uses payload fallback when no token_count exists and preserves unknown metadata", () => {
    const result = parseCodexFilesV5([
      input("/sessions/a.jsonl", [sessionMeta("a", 100), payloadUsage(110, { input_tokens: 7, output_tokens: 1 })]),
    ]);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ model: "unknown", projectKey: "unknown", usage: { inputTokens: 7, outputTokens: 1 } });
    expect(result.diagnostics.projection.unknownModelRecords).toBe(1);
    expect(result.diagnostics.projection.unknownProjectRecords).toBe(1);
  });

  it("applies fork cumulative baseline before TokenCount accounting", () => {
    const result = parseCodexFilesV5([
      input("/sessions/parent.jsonl", [sessionMeta("parent", 100), tokenCount(150, {}, { total: { total_tokens: 150 } })]),
      input("/sessions/child.jsonl", [sessionMeta("child", 200, { parent: "parent" }), tokenCount(210, {}, { total: { total_tokens: 180 } })]),
    ]);
    const child = result.sessions.find((session) => session.sessionId === "child");
    const childRecord = result.records.find((record) => record.sessionId === "child");

    expect(child?.finalTokenCount).toBe(30);
    expect(childRecord?.usage.inputTokens).toBe(30);
    expect(result.safeToActivate).toBe(true);
  });

  it("suppresses explicit fork replay prefix only before the fork boundary", () => {
    const result = parseCodexFilesV5([
      input("/sessions/parent.jsonl", [
        sessionMeta("parent", 50),
        tokenCount(100, { input_tokens: 10, output_tokens: 0 }, { responseId: "a" }),
        tokenCount(200, { input_tokens: 20, output_tokens: 0 }, { responseId: "b" }),
      ]),
      input("/sessions/child.jsonl", [
        sessionMeta("child", 300, { parent: "parent" }),
        tokenCount(100, { input_tokens: 10, output_tokens: 0 }, { responseId: "a" }),
        tokenCount(200, { input_tokens: 20, output_tokens: 0 }, { responseId: "b" }),
        tokenCount(300, { input_tokens: 30, output_tokens: 0 }, { responseId: "c" }),
      ]),
    ]);
    const child = result.sessions.find((session) => session.sessionId === "child");

    expect(child?.canonicalBeforeForkReplay).toHaveLength(3);
    expect(child?.canonicalAfterForkReplay).toHaveLength(1);
    expect(child?.canonicalAfterForkReplay[0]?.usage.inputTokens).toBe(30);
    expect(result.diagnostics.forkReplay.replaySuppressedEvents).toBe(2);
  });

  it("keeps fork baselines and replay accounting stable around a child semantic duplicate", () => {
    const result = parseCodexFilesV5([
      input("/sessions/parent.jsonl", [
        sessionMeta("parent", 100),
        tokenCount(150, { input_tokens: 100, output_tokens: 0 }, { total: { input_tokens: 100, output_tokens: 0, total_tokens: 100 } }),
      ]),
      input("/sessions/child.jsonl", [
        sessionMeta("child", 200, { parent: "parent" }),
        tokenCount(210, { input_tokens: 20, output_tokens: 0 }, { total: { input_tokens: 120, output_tokens: 0, total_tokens: 120 } }),
        tokenCount(220, { input_tokens: 60, output_tokens: 0 }, { total: { input_tokens: 180, output_tokens: 0, total_tokens: 180 } }),
        tokenCount(220, { input_tokens: 50, output_tokens: 0 }, { total: { input_tokens: 180, output_tokens: 0, total_tokens: 180 } }),
        tokenCount(230, { input_tokens: 20, output_tokens: 0 }, { total: { input_tokens: 200, output_tokens: 0, total_tokens: 200 } }),
      ]),
    ]);
    const child = result.sessions.find((session) => session.sessionId === "child");

    expect(result.diagnostics.tokenCount).toMatchObject({ semanticSnapshotDuplicateEvents: 1, duplicateConflicts: 0 });
    expect(result.diagnostics.forkBaseline).toMatchObject({ forkSessions: 1, resolvedBaselineSessions: 1 });
    expect(result.diagnostics.invariants).toMatchObject({ tokenCountDuplicateEvent: true, forkContribution: true, forkToken: true });
    expect(child?.canonicalBeforeForkReplay.map((item) => item.aggregateTotal)).toEqual([20, 60, 20]);
    expect(child?.finalTokenCount).toBe(100);
    expect(result.safeToActivate).toBe(true);
  });

  it("blocks activation for a missing fork parent", () => {
    const result = parseCodexFilesV5([
      input("/sessions/child.jsonl", [
        sessionMeta("child", 200, { parent: "missing-parent" }),
        tokenCount(210, {}, { total: { total_tokens: 20 } }),
      ]),
    ]);

    expect(result.records).toHaveLength(1);
    expect(result.diagnostics.forkBaseline.missingParentSessions).toBe(1);
    expect(result.diagnostics.activation.forkResolution).toBe(false);
    expect(result.safeToActivate).toBe(false);
  });

  it("blocks activation for a fork without a deterministic fork timestamp", () => {
    const result = parseCodexFilesV5([
      input("/sessions/parent.jsonl", [sessionMeta("parent", 100), tokenCount(110, {}, { total: { total_tokens: 10 } })]),
      input("/sessions/child.jsonl", [sessionMeta("child", undefined, { parent: "parent" }), tokenCount(210, {}, { total: { total_tokens: 20 } })]),
    ]);

    expect(result.diagnostics.forkBaseline.missingForkTimestampSessions).toBe(1);
    expect(result.diagnostics.activation.forkResolution).toBe(false);
    expect(result.safeToActivate).toBe(false);
  });

  it("blocks activation when fork replay identity diverges after a matching prefix", () => {
    const result = parseCodexFilesV5([
      input("/sessions/parent.jsonl", [
        sessionMeta("parent", 50),
        tokenCount(100, { input_tokens: 10, output_tokens: 0 }, { responseId: "a" }),
        tokenCount(200, { input_tokens: 20, output_tokens: 0 }, { responseId: "b" }),
      ]),
      input("/sessions/child.jsonl", [
        sessionMeta("child", 300, { parent: "parent" }),
        tokenCount(100, { input_tokens: 10, output_tokens: 0 }, { responseId: "a" }),
        tokenCount(200, { input_tokens: 99, output_tokens: 0 }, { responseId: "x" }),
        tokenCount(300, { input_tokens: 30, output_tokens: 0 }, { responseId: "c" }),
      ]),
    ]);

    expect(result.diagnostics.forkReplay.replaySuppressedEvents).toBe(1);
    expect(result.diagnostics.forkReplay.replayPrefixMismatchSessions).toBe(1);
    expect(result.diagnostics.invariants.forkContribution).toBe(true);
    expect(result.diagnostics.invariants.forkToken).toBe(true);
    expect(result.diagnostics.activation.forkResolution).toBe(false);
    expect(result.safeToActivate).toBe(false);
  });

  it("blocks activation when a TokenCount contribution is unresolved", () => {
    const result = parseCodexFilesV5([
      input("/sessions/a.jsonl", [
        sessionMeta("a", 100),
        {
          type: "token_count",
          timestamp: 110,
          payload: { info: { total_token_usage: { cached_input_tokens: 10 } } },
        },
        {
          type: "token_count",
          timestamp: 120,
          payload: { info: { total_token_usage: { output_tokens: 2 } } },
        },
      ]),
    ]);

    expect(result.diagnostics.tokenCount.methods.unresolved).toBe(1);
    expect(result.diagnostics.activation.tokenCountCompleteness).toBe(false);
    expect(result.safeToActivate).toBe(false);
  });

  it("keeps a deterministic child counter reset activatable", () => {
    const result = parseCodexFilesV5([
      input("/sessions/parent.jsonl", [sessionMeta("parent", 100), tokenCount(150, {}, { total: { total_tokens: 150 } })]),
      input("/sessions/child.jsonl", [sessionMeta("child", 200, { parent: "parent" }), tokenCount(210, {}, { total: { total_tokens: 20 } })]),
    ]);

    expect(result.diagnostics.forkBaseline.counterResetAtForkSessions).toBe(1);
    expect(result.diagnostics.activation.forkResolution).toBe(true);
  });

  it("rejects divergent logical files and orphan files from activation", () => {
    const result = parseCodexFilesV5([
      input("/sessions/a.jsonl", [sessionMeta("a", 100), payloadUsage(110, { input_tokens: 1, output_tokens: 0 })]),
      input("/archived_sessions/a.jsonl", [sessionMeta("a", 100), payloadUsage(110, { input_tokens: 2, output_tokens: 0 })]),
      input("/sessions/orphan.jsonl", [payloadUsage(110, { input_tokens: 1, output_tokens: 0 })]),
    ]);

    expect(result.records).toHaveLength(0);
    expect(result.diagnostics.reconcile.conflictingLogicalSessions).toBe(1);
    expect(result.diagnostics.reconcile.orphanFiles).toBe(1);
    expect(result.safeToActivate).toBe(false);
  });

  it("keeps record identity stable when only the backing path moves", () => {
    const first = parseCodexFilesV5([input("/sessions/a.jsonl", [sessionMeta("a", 100), payloadUsage(110, { input_tokens: 7, output_tokens: 1 })])]);
    const moved = parseCodexFilesV5([input("/archived_sessions/a.jsonl", [sessionMeta("a", 100), payloadUsage(110, { input_tokens: 7, output_tokens: 1 })])]);

    expect(moved.records[0]?.id).toBe(first.records[0]?.id);
    expect(moved.records[0]?.sourcePath).not.toBe(first.records[0]?.sourcePath);
    expect(moved.records[0]?.usage).toEqual(first.records[0]?.usage);
  });
});
