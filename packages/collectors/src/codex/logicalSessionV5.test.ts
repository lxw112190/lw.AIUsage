import { describe, expect, it } from "vitest";
import type { CodexAccountingEvent } from "./accountingV5";
import type { CodexDecodedFileV5 } from "./eventDecoderV5";
import { reconcileCodexLogicalSessionsV5 } from "./logicalSessionV5";

const event = (rawIdentity: string, eventIndex: number): CodexAccountingEvent => ({
  sourcePath: "/fixture/session.jsonl",
  eventIndex,
  rawIdentity,
});

const file = (
  sourcePath: string,
  rawIdentities: string[],
  options: { sessionId?: string; logicalIdHint?: string; parentSessionId?: string; forkTimestamp?: number } = {},
): CodexDecodedFileV5 => ({
  sourcePath,
  logicalIdHint: options.logicalIdHint,
  sessionId: options.sessionId,
  parentSessionId: options.parentSessionId,
  forkTimestamp: options.forkTimestamp,
  events: rawIdentities.map((rawIdentity, eventIndex) => event(rawIdentity, eventIndex)),
  rawEventCount: rawIdentities.length,
  parseErrors: [],
  hasPendingText: false,
  diagnostics: {
    tokenCountEvents: 0,
    payloadUsageEvents: 0,
    legacyFlatUsageEvents: 0,
    nestedUsageOnNonTokenEvents: 0,
    missingTimestampEvents: 0,
    sessionMetaEvents: 0,
    sessionIdentityConflicts: 0,
    parentIdentityConflicts: 0,
  },
});

describe("Codex v5 logical session reconciliation", () => {
  it("keeps one exact duplicate file and prefers the non-archived representative", () => {
    const result = reconcileCodexLogicalSessionsV5([
      file("/archived_sessions/a.jsonl", ["a", "b"], { sessionId: "s" }),
      file("/sessions/a.jsonl", ["a", "b"], { sessionId: "s" }),
    ]);

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ sessionId: "s", sourcePath: "/sessions/a.jsonl", shadowedSourcePaths: ["/archived_sessions/a.jsonl"] });
    expect(result.diagnostics.exactDuplicateFiles).toBe(1);
  });

  it("selects the longer file when the other file is a stale prefix", () => {
    const result = reconcileCodexLogicalSessionsV5([
      file("/archived_sessions/a.jsonl", ["a", "b"], { sessionId: "s" }),
      file("/sessions/a.jsonl", ["a", "b", "c", "d"], { sessionId: "s" }),
    ]);

    expect(result.sessions[0]).toMatchObject({ sourcePath: "/sessions/a.jsonl", events: expect.arrayContaining([expect.objectContaining({ rawIdentity: "d" })]) });
    expect(result.diagnostics.prefixShadowedFiles).toBe(1);
  });

  it("does not merge divergent logical sessions", () => {
    const result = reconcileCodexLogicalSessionsV5([
      file("/sessions/a.jsonl", ["a", "b", "x"], { sessionId: "s" }),
      file("/archived_sessions/a.jsonl", ["a", "b", "y"], { sessionId: "s" }),
    ]);

    expect(result.sessions).toHaveLength(0);
    expect(result.conflicts[0]).toMatchObject({ sessionId: "s", reason: "divergent-events" });
    expect(result.diagnostics.conflicts).toEqual([expect.objectContaining({
      sessionId: "s",
      reason: "divergent-events",
      sourcePaths: expect.arrayContaining(["/sessions/a.jsonl", "/archived_sessions/a.jsonl"]),
    })]);
    expect(result.diagnostics.conflictingLogicalSessions).toBe(1);
  });

  it("rejects parent or fork metadata conflicts", () => {
    const result = reconcileCodexLogicalSessionsV5([
      file("/sessions/a.jsonl", ["a"], { sessionId: "s", parentSessionId: "p", forkTimestamp: 100 }),
      file("/archived_sessions/a.jsonl", ["a"], { sessionId: "s", parentSessionId: "q", forkTimestamp: 100 }),
    ]);

    expect(result.conflicts[0]?.reason).toBe("metadata-conflict");
    expect(result.sessions).toHaveLength(0);
  });

  it("routes files without session identity to orphan diagnostics", () => {
    const result = reconcileCodexLogicalSessionsV5([
      file("/sessions/orphan.jsonl", ["a"]),
      file("/sessions/hinted.jsonl", ["b"], { logicalIdHint: "hinted" }),
    ]);

    expect(result.orphanFiles).toHaveLength(1);
    expect(result.sessions[0]?.sessionId).toBe("hinted");
    expect(result.diagnostics.orphanFiles).toBe(1);
  });
});
