import { describe, expect, it } from "vitest";
import { auditCodexForkHistory } from "./forkHistoryAudit";
import type { ParserV4MirrorRecord, V4ForkTrace } from "./rawAuditTypes";

const usage = (inputTokens: number) => ({
  inputTokens,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
});

const record = (id: string, sessionId: string, inputTokens: number): ParserV4MirrorRecord => ({
  id,
  sessionId,
  timestamp: 1,
  model: "gpt-5",
  projectKey: "fixture",
  sourceKind: "token-count",
  usage: usage(inputTokens),
});

describe("Codex fork history audit", () => {
  it("explains mirror-only child records from the persisted baseline difference", () => {
    const trace: V4ForkTrace = {
      childSessionId: "child",
      parentSessionId: "parent",
      baselineUsed: usage(1_000),
      firstTotal: usage(1_200),
      firstContribution: usage(200),
    };
    const report = auditCodexForkHistory(
      [trace],
      [{ parserState: { sessionId: "child", forkedFromSessionId: "parent", forkBaselineUsage: usage(1_200) } }],
      [record("child-extra", "child", 200)],
      new Set(),
    );

    expect(report.forkSessions).toBe(1);
    expect(report.baselineDifferent).toBe(1);
    expect(report.explainedMirrorOnlyRecords).toBe(1);
    expect(report.unexplainedMirrorOnlyRecords).toBe(0);
    expect(report.explainedTokens).toBe(200);
    expect(report.items[0]?.explainsMirrorOnly).toBe(true);
    expect(report.items[0]?.childSessionHash).not.toBe("child");
  });

  it("does not claim a fork explanation when there is no contribution difference", () => {
    const report = auditCodexForkHistory(
      [{ childSessionId: "child", parentSessionId: "parent", baselineUsed: usage(1_000), firstTotal: usage(1_200), firstContribution: usage(200) }],
      [{ parserState: { sessionId: "child", forkedFromSessionId: "parent", forkBaselineUsage: usage(1_000) } }],
      [record("child-extra", "child", 100)],
      new Set(),
    );

    expect(report.baselineMatched).toBe(1);
    expect(report.explainedMirrorOnlyRecords).toBe(0);
    expect(report.unexplainedMirrorOnlyRecords).toBe(1);
  });
});
