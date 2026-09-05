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
      firstUsageEventId: "child-extra",
      baselineUsed: usage(1_000),
      firstTotal: usage(1_200),
      firstContribution: usage(200),
    };
    const report = auditCodexForkHistory(
      [trace],
      [{ parserState: { sessionId: "child", forkedFromSessionId: "parent", forkBaselineUsage: usage(1_200) } }],
      [record("child-extra", "child", 200)],
      { mirrorOnlyIds: new Set(["child-extra"]), databaseOnlyIds: new Set(), contentMismatchIds: new Set() },
    );

    expect(report.forkSessions).toBe(1);
    expect(report.baselineDifferent).toBe(1);
    expect(report.explainedMirrorOnlyRecords).toBe(1);
    expect(report.unexplainedMirrorOnlyRecords).toBe(0);
    expect(report.explainedTokens).toBe(200);
    expect(report.items[0]?.explainsMirrorOnly).toBe(true);
    expect(report.items[0]?.outcome).toBe("full-replay-only");
    expect(report.forkMirrorOnlyInvariant).toBe(true);
    expect(report.forkMirrorOnlyExplainedPercent).toBe(100);
    expect(report.items[0]?.childSessionHash).not.toBe("child");
  });

  it("does not claim a fork explanation when there is no contribution difference", () => {
    const report = auditCodexForkHistory(
      [{ childSessionId: "child", parentSessionId: "parent", baselineUsed: usage(1_000), firstTotal: usage(1_200), firstContribution: usage(200) }],
      [{ parserState: { sessionId: "child", forkedFromSessionId: "parent", forkBaselineUsage: usage(1_000) } }],
      [record("child-extra", "child", 100)],
      { mirrorOnlyIds: new Set(["child-extra"]), databaseOnlyIds: new Set(), contentMismatchIds: new Set() },
    );

    expect(report.baselineMatched).toBe(1);
    expect(report.explainedMirrorOnlyRecords).toBe(0);
    expect(report.unexplainedMirrorOnlyRecords).toBe(1);
  });

  it("compares fork baselines component by component", () => {
    const report = auditCodexForkHistory(
      [{ childSessionId: "child", parentSessionId: "parent", baselineUsed: usage(200), firstTotal: usage(300), firstContribution: usage(100) }],
      [{ parserState: { sessionId: "child", forkedFromSessionId: "parent", forkBaselineUsage: { ...usage(100), cachedInputTokens: 100 } } }],
      [],
      { mirrorOnlyIds: new Set(), databaseOnlyIds: new Set(), contentMismatchIds: new Set() },
    );

    expect(report.baselineMatched).toBe(0);
    expect(report.baselineDifferent).toBe(1);
    expect(report.items[0]?.baselineDifferenceNetTokens).toBe(0);
    expect(report.items[0]?.baselineDifferenceMagnitudeTokens).toBe(200);
  });

  it("reports fork-local and global mirror-only explanation rates separately", () => {
    const trace: V4ForkTrace = {
      childSessionId: "child",
      parentSessionId: "parent",
      firstUsageEventId: "fork-one",
      baselineUsed: usage(1_000),
      firstTotal: usage(1_200),
      firstContribution: usage(200),
    };
    const mirrorRecords = [
      record("fork-one", "child", 200),
      record("fork-two", "child", 50),
      record("other-one", "other", 20),
      record("other-two", "other", 20),
      record("other-three", "other", 20),
    ];
    const report = auditCodexForkHistory(
      [trace],
      [{ parserState: { sessionId: "child", forkedFromSessionId: "parent", forkBaselineUsage: usage(1_200) } }],
      mirrorRecords,
      { mirrorOnlyIds: new Set(mirrorRecords.map((item) => item.id)), databaseOnlyIds: new Set(), contentMismatchIds: new Set() },
    );

    expect(report.globalMirrorOnlyRecords).toBe(5);
    expect(report.forkMirrorOnlyRecords).toBe(2);
    expect(report.explainedMirrorOnlyRecords).toBe(1);
    expect(report.forkMirrorOnlyExplainedPercent).toBe(50);
    expect(report.globalMirrorOnlyExplainedPercent).toBe(20);
    expect(report.allGlobalMirrorOnlyExplainedByFork).toBe(false);
    expect(report.forkMirrorOnlyInvariant).toBe(true);
  });
});
