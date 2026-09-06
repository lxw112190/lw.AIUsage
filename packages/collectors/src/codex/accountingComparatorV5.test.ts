import { describe, expect, it } from "vitest";
import type { FileEntry } from "@lw-aiusage/platform";
import type { CodexExtractedEvent, CodexExtractedFile } from "./rawAuditTypes";
import { compareCodexV4V5 } from "./accountingComparatorV5";

const entry = (path: string): FileEntry => ({
  path,
  name: path.split("/").at(-1) ?? path,
  isFile: true,
  isDirectory: false,
  size: 1,
  modifiedAt: 1,
});

const file = (path: string, events: CodexExtractedEvent[], sessionId = "session"): CodexExtractedFile => ({
  entry: entry(path),
  snapshotSize: 1,
  peekLogicalId: sessionId,
  finalSessionId: sessionId,
  events,
  parseErrors: [],
});

const tokenEvent = (index: number, timestamp: number, input: number, responseId?: string): CodexExtractedEvent => ({
  raw: {
    type: "token_count",
    timestamp,
    payload: {
      model: "gpt-5",
      ...(responseId ? { response_id: responseId } : {}),
      info: { last_token_usage: { input_tokens: input, output_tokens: 0 } },
    },
  },
  eventIndex: index,
  eventType: "token_count",
  explicitTimestamp: timestamp * 1000,
  resolvedModel: "gpt-5",
  resolvedSessionId: "session",
  source: "token-count",
  outerType: "token_count",
  semanticType: "token_count",
  isTokenCount: true,
});

describe("Codex v4-v5 accounting comparator", () => {
  it("reports a balanced zero-delta comparison for identical accounting", () => {
    const result = compareCodexV4V5([file("/sessions/a.jsonl", [
      tokenEvent(0, 100, 10, "a"),
      tokenEvent(1, 110, 20, "b"),
    ])]);

    expect(result.comparatorVersion).toBe(3);
    expect(result.v4.totalTokens).toBe(30);
    expect(result.v5.canonicalTokens).toBe(30);
    expect(result.difference.accountingTokens).toBe(0);
    expect(result.attribution.changedEvents).toBe(0);
    expect(result.attribution.unexplainedDelta).toBe(0);
    expect(result.gates.accountingBalanced).toBe(true);
    expect(result.readyForCollectorSwitch).toBe(true);
  });

  it("attributes nested non-token usage to taxonomy correction", () => {
    const nested: CodexExtractedEvent = {
      raw: {
        type: "response_item",
        timestamp: 100,
        payload: {
          model: "gpt-5",
          info: { last_token_usage: { input_tokens: 100, output_tokens: 0 } },
        },
      },
      eventIndex: 0,
      eventType: "response_item",
      explicitTimestamp: 100_000,
      resolvedModel: "gpt-5",
      resolvedSessionId: "session",
      source: "nested-info-non-token-count",
      outerType: "response_item",
      semanticType: "response_item",
      isTokenCount: false,
    };
    const result = compareCodexV4V5([file("/sessions/a.jsonl", [nested])]);
    const changed = result.comparisonEntries.find((entry) => entry.delta !== 0);

    expect(result.difference.accountingTokens).toBe(-100);
    expect(changed?.reason).toBe("taxonomy-non-token-usage");
    expect(changed?.explained).toBe(true);
    expect(result.attribution.unexplainedDelta).toBe(0);
    expect(result.readyForCollectorSwitch).toBe(true);
  });

  it("attributes explicit child replay removal to fork replay", () => {
    const parent = file("/sessions/parent.jsonl", [
      tokenEvent(0, 100, 10, "a"),
      tokenEvent(1, 200, 20, "b"),
    ], "parent");
    const child = file("/sessions/child.jsonl", [
      {
        raw: { type: "session_meta", timestamp: 300, payload: { id: "child", forked_from_id: "parent" } },
        eventIndex: 0,
        eventType: "session_meta",
        explicitTimestamp: 300_000,
        resolvedSessionId: "child",
        forkedFromId: "parent",
        outerType: "session_meta",
        semanticType: "session_meta",
        isTokenCount: false,
      },
      tokenEvent(1, 100, 10, "a"),
      tokenEvent(2, 200, 20, "b"),
      tokenEvent(3, 300, 30, "c"),
    ], "child");
    const result = compareCodexV4V5([parent, child]);
    const replayEntries = result.comparisonEntries.filter((entry) => entry.reason === "fork-replay");

    expect(replayEntries).toHaveLength(2);
    expect(replayEntries.reduce((sum, entry) => sum + entry.delta, 0)).toBe(-30);
    expect(result.attribution.unexplainedDelta).toBe(0);
    expect(result.gates.accountingBalanced).toBe(true);
  });

  it("uses direct same-response payload suppression evidence", () => {
    const payload: CodexExtractedEvent = {
      raw: {
        type: "response_item",
        timestamp: 101,
        payload: { model: "gpt-5", response_id: "r", usage: { input_tokens: 10, output_tokens: 0 } },
      },
      eventIndex: 1,
      eventType: "response_item",
      explicitTimestamp: 101_000,
      resolvedModel: "gpt-5",
      resolvedSessionId: "session",
      source: "payload-usage",
      outerType: "response_item",
      semanticType: "response_item",
      isTokenCount: false,
    };
    const result = compareCodexV4V5([file("/sessions/a.jsonl", [tokenEvent(0, 100, 10, "r"), payload])]);
    const suppressed = result.comparisonEntries.find((entry) => entry.rawIdentity.includes("e1:"));

    expect(suppressed?.signals).toEqual([expect.objectContaining({
      reason: "payload-suppression",
      evidence: "same-response-id-components",
    })]);
    expect(suppressed?.reason).toBe("payload-suppression");
    expect(suppressed?.explained).toBe(true);
  });

  it("marks an event with fork baseline and payload fallback as mixed", () => {
    const parent = file("/sessions/parent.jsonl", [{
      ...tokenEvent(0, 100, 150),
      raw: { type: "token_count", timestamp: 100, payload: { model: "gpt-5", info: { total_token_usage: { input_tokens: 150, output_tokens: 0, total_tokens: 150 } } } },
    }], "parent");
    const child = file("/sessions/child.jsonl", [
      {
        raw: { type: "session_meta", timestamp: 200, payload: { id: "child", forked_from_id: "parent" } },
        eventIndex: 0,
        eventType: "session_meta",
        explicitTimestamp: 200_000,
        resolvedSessionId: "child",
        forkedFromId: "parent",
        outerType: "session_meta",
        semanticType: "session_meta",
        isTokenCount: false,
      },
      {
        raw: {
          type: "token_count",
          timestamp: 210,
          payload: {
            model: "gpt-5",
            info: {
              total_token_usage: { input_tokens: 180, output_tokens: 0, total_tokens: 180 },
            },
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
        eventIndex: 1,
        eventType: "token_count",
        explicitTimestamp: 210_000,
        resolvedModel: "gpt-5",
        resolvedSessionId: "child",
        source: "token-count",
        outerType: "token_count",
        semanticType: "token_count",
        isTokenCount: true,
      },
    ], "child");
    const result = compareCodexV4V5([parent, child]);
    const mixed = result.comparisonEntries.find((entry) => entry.sessionId === "child" && entry.eventIndex === 1);

    expect(mixed?.signals.map((signal) => signal.reason)).toEqual(["fork-baseline", "payload-fallback"]);
    expect(mixed?.reason).toBe("mixed");
    expect(mixed?.explained).toBe(false);
    expect(result.attribution.mixedEvents).toBe(1);
    expect(result.gates.attributionComplete).toBe(false);
    expect(result.readyForCollectorSwitch).toBe(false);
  });

  it("does not attribute a fork baseline when last usage makes its effect zero", () => {
    const parent = file("/sessions/parent.jsonl", [{
      ...tokenEvent(0, 100, 150),
      raw: { type: "token_count", timestamp: 100, payload: { model: "gpt-5", info: { total_token_usage: { total_tokens: 150 } } } },
    }], "parent");
    const child = file("/sessions/child.jsonl", [
      {
        raw: { type: "session_meta", timestamp: 200, payload: { id: "child", forked_from_id: "parent" } },
        eventIndex: 0,
        eventType: "session_meta",
        explicitTimestamp: 200_000,
        resolvedSessionId: "child",
        forkedFromId: "parent",
        outerType: "session_meta",
        semanticType: "session_meta",
        isTokenCount: false,
      },
      {
        raw: { type: "token_count", timestamp: 210, payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 30, output_tokens: 0 }, total_token_usage: { total_tokens: 180 } } } },
        eventIndex: 1,
        eventType: "token_count",
        explicitTimestamp: 210_000,
        resolvedModel: "gpt-5",
        resolvedSessionId: "child",
        source: "token-count",
        outerType: "token_count",
        semanticType: "token_count",
        isTokenCount: true,
      },
    ], "child");
    const result = compareCodexV4V5([parent, child]);
    const childEvent = result.comparisonEntries.find((entry) => entry.sessionId === "child" && entry.eventIndex === 1);

    expect(childEvent?.signals.some((signal) => signal.reason === "fork-baseline")).toBe(false);
    expect(childEvent?.reason).toBe("same");
  });

  it("does not report a payload fallback signal after fork replay removes it", () => {
    const payloadEvent = (index: number, sessionId: string): CodexExtractedEvent => ({
      raw: { type: "response_item", timestamp: 100, payload: { model: "gpt-5", response_id: "replay", usage: { input_tokens: 10, output_tokens: 0 } } },
      eventIndex: index,
      eventType: "response_item",
      explicitTimestamp: 100_000,
      resolvedModel: "gpt-5",
      resolvedSessionId: sessionId,
      source: "payload-usage",
      outerType: "response_item",
      semanticType: "response_item",
      isTokenCount: false,
    });
    const parent = file("/sessions/parent.jsonl", [payloadEvent(0, "parent")], "parent");
    const child = file("/sessions/child.jsonl", [
      {
        raw: { type: "session_meta", timestamp: 300, payload: { id: "child", forked_from_id: "parent" } },
        eventIndex: 0,
        eventType: "session_meta",
        explicitTimestamp: 300_000,
        resolvedSessionId: "child",
        forkedFromId: "parent",
        outerType: "session_meta",
        semanticType: "session_meta",
        isTokenCount: false,
      },
      payloadEvent(1, "child"),
    ], "child");
    const result = compareCodexV4V5([parent, child]);
    const childReplay = result.comparisonEntries.find((entry) => entry.sessionId === "child" && entry.eventIndex === 1);

    expect(childReplay?.signals.map((signal) => signal.reason)).toEqual(["fork-replay"]);
    expect(childReplay?.reason).toBe("fork-replay");
  });

  it("does not call a component-only difference same", () => {
    const first: CodexExtractedEvent = {
      raw: { type: "token_count", timestamp: 100, payload: { model: "gpt-5", info: { total_token_usage: { total_tokens: 100 } } } },
      eventIndex: 0,
      eventType: "token_count",
      explicitTimestamp: 100_000,
      resolvedModel: "gpt-5",
      resolvedSessionId: "session",
      source: "token-count",
      outerType: "token_count",
      semanticType: "token_count",
      isTokenCount: true,
    };
    const second: CodexExtractedEvent = {
      raw: { type: "token_count", timestamp: 110, payload: { model: "gpt-5", info: { total_token_usage: { total_tokens: 200, cached_input_tokens: 100 } } } },
      eventIndex: 1,
      eventType: "token_count",
      explicitTimestamp: 110_000,
      resolvedModel: "gpt-5",
      resolvedSessionId: "session",
      source: "token-count",
      outerType: "token_count",
      semanticType: "token_count",
      isTokenCount: true,
    };
    const result = compareCodexV4V5([file("/sessions/a.jsonl", [first, second])]);
    const changed = result.comparisonEntries.find((entry) => entry.eventIndex === 1);

    expect(changed?.delta).toBe(0);
    expect(changed?.componentDelta.inputTokens).toBe(100);
    expect(changed?.componentDelta.cachedInputTokens).toBe(-100);
    expect(result.attribution.changedEvents).toBe(1);
    expect(changed?.reason).toBe("token-aggregate");
    expect(changed?.explained).toBe(true);
  });

  it("keeps projection loss separate from accounting delta for a missing timestamp", () => {
    const result = compareCodexV4V5([file("/sessions/a.jsonl", [{
      ...tokenEvent(0, 0, 100, "missing-time"),
      raw: {
        type: "token_count",
        payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 100, output_tokens: 0 } } },
      },
      explicitTimestamp: undefined,
    }])]);

    expect(result.v5.canonicalTokens).toBe(100);
    expect(result.v5.emittedTokens).toBe(0);
    expect(result.difference.accountingTokens).toBe(0);
    expect(result.difference.projectionTokens).toBe(-100);
    expect(result.gates.v5Activation).toBe(false);
    expect(result.readyForCollectorSwitch).toBe(false);
  });

  it("is deterministic when the same snapshot files arrive in another order", () => {
    const a = file("/sessions/a.jsonl", [tokenEvent(0, 100, 10, "a")], "a");
    const b = file("/sessions/b.jsonl", [tokenEvent(0, 100, 20, "b")], "b");
    const first = compareCodexV4V5([a, b]);
    const second = compareCodexV4V5([b, a]);

    expect(second.v4).toEqual(first.v4);
    expect(second.v5).toEqual(first.v5);
    expect(second.difference).toEqual(first.difference);
    expect(second.attribution).toEqual(first.attribution);
    expect(second.comparisonEntries).toEqual(first.comparisonEntries);
  });

  it("exports safe logical conflict evidence without decoded file payloads", () => {
    const first = file("/sessions/a.jsonl", [tokenEvent(0, 100, 10, "a")], "session");
    const second = file("/sessions/b.jsonl", [tokenEvent(0, 100, 20, "a")], "session");
    const result = compareCodexV4V5([first, second]);

    expect(result.conflicts).toEqual([expect.objectContaining({
      sessionId: "session",
      reason: "divergent-events",
      sourcePaths: ["/sessions/a.jsonl", "/sessions/b.jsonl"],
    })]);
    expect(result.v5.diagnostics.reconcile.conflicts).toEqual(result.conflicts);
    expect(result.v5.diagnostics.reconcile.conflicts[0]).not.toHaveProperty("files");
  });

  it("reports exact raw-content duplicate evidence separately from v5 accounting", () => {
    const first = { ...tokenEvent(0, 100, 10, "same"), last: { input: 10, cachedInput: 0, cacheCreationInput: 0, output: 0, reasoningOutput: 0, total: 10 } };
    const second = { ...tokenEvent(1, 100, 10, "same"), last: { input: 10, cachedInput: 0, cacheCreationInput: 0, output: 0, reasoningOutput: 0, total: 10 } };
    const result = compareCodexV4V5([file("/sessions/a.jsonl", [first, second])]);

    expect(result.rawContentDuplicates.groups).toBe(1);
    expect(result.rawContentDuplicates.duplicateOccurrences).toBe(1);
    expect(result.rawContentDuplicates.candidateExtraTokens).toBe(10);
    expect(result.rawContentDuplicates.examples[0]).toMatchObject({
      sessionId: "session",
      occurrences: 2,
      eventIndexes: [0, 1],
      aggregateTokens: 10,
    });
  });

  it("resolves a colliding record id with timestamp metadata", () => {
    const first = { ...tokenEvent(0, 100, 10), raw: { ...tokenEvent(0, 100, 10).raw, response_id: "collision" } };
    const second = { ...tokenEvent(1, 200, 20), raw: { ...tokenEvent(1, 200, 20).raw, response_id: "collision" } };
    const result = compareCodexV4V5([file("/sessions/a.jsonl", [first, second])]);

    expect(result.universe.v4RecordMapping.resolvedByMetadataRecords).toBe(1);
    expect(result.universe.v4RecordMapping.ambiguousRecords).toBe(0);
    expect(result.comparisonEntries.find((entry) => entry.eventIndex === 1)?.v4?.mappingKind).toBe("resolved-metadata");
  });

  it("resolves a colliding record id with source kind metadata", () => {
    const token = { ...tokenEvent(0, 100, 10), raw: { ...tokenEvent(0, 100, 10).raw, response_id: "source-kind" } };
    const payload: CodexExtractedEvent = {
      raw: { type: "response_item", timestamp: 100, response_id: "source-kind", payload: { model: "gpt-5", usage: { input_tokens: 5 } } },
      eventIndex: 1,
      eventType: "response_item",
      explicitTimestamp: 100_000,
      resolvedModel: "gpt-5",
      resolvedSessionId: "session",
      source: "payload-usage",
      outerType: "response_item",
      semanticType: "response_item",
      isTokenCount: false,
    };
    const result = compareCodexV4V5([file("/sessions/a.jsonl", [token, payload])]);

    expect(result.universe.v4RecordMapping.resolvedByMetadataRecords).toBe(1);
    expect(result.comparisonEntries.find((entry) => entry.eventIndex === 1)?.v4?.mappingKind).toBe("resolved-metadata");
  });

  it("keeps an equivalent raw collision diagnostic-only", () => {
    const first = { ...tokenEvent(0, 100, 10), raw: { ...tokenEvent(0, 100, 10).raw, response_id: "same" } };
    const second = { ...first, eventIndex: 1 };
    const result = compareCodexV4V5([file("/sessions/a.jsonl", [first, second])]);

    expect(result.universe.v4RecordMapping.equivalentCollisionRecords).toBe(1);
    expect(result.universe.v4RecordMapping.ambiguousRecords).toBe(0);
    expect(result.universe.v4RecordMapping.equivalentCollisionExamples[0]?.mappingKind).toBe("equivalent-collision");
    expect(result.comparisonEntries.filter((entry) => entry.v4?.mappingKind === "equivalent-collision")).toHaveLength(1);
    expect(result.attribution.unexplainedDelta).not.toBe(0);
  });

  it("does not resolve a same-hash collision when V5 usage differs", () => {
    const first = {
      ...tokenEvent(0, 100, 10),
      raw: { type: "token_count", timestamp: 100, response_id: "same", payload: { model: "gpt-5", info: { total_token_usage: { input_tokens: 10, total_tokens: 10 } } } },
    };
    const second = { ...first, eventIndex: 1 };
    const result = compareCodexV4V5([file("/sessions/a.jsonl", [first, second])]);

    expect(result.universe.v4RecordMapping.equivalentCollisionRecords).toBe(0);
    expect(result.universe.v4RecordMapping.ambiguousRecords).toBe(1);
    const evidence = result.universe.v4RecordMapping.ambiguousExamples[0];
    expect(evidence?.mappingKind).toBe("ambiguous");
    expect(evidence?.usageMatchCandidates).toBe(1);
    expect(evidence?.candidates.filter((candidate) => candidate.v4UsageMatchesAfterFork)).toHaveLength(1);
    expect(result.universe.v4RecordMapping.ambiguousUsageUniqueMatchRecords).toBe(1);
    expect(result.universe.v4RecordMapping.ambiguousUsageNoMatchRecords).toBe(0);
    expect(result.universe.v4RecordMapping.ambiguousUsageMultipleMatchRecords).toBe(0);
  });

  it("reports fork family deltas without changing attribution", () => {
    const parent = file("/sessions/parent.jsonl", [tokenEvent(0, 100, 10, "parent")], "parent");
    const child = file("/sessions/child.jsonl", [
      { raw: { type: "session_meta", timestamp: 200, payload: { id: "child", forked_from_id: "parent" } }, eventIndex: 0, eventType: "session_meta", explicitTimestamp: 200_000, resolvedSessionId: "child", forkedFromId: "parent", outerType: "session_meta", semanticType: "session_meta", isTokenCount: false },
      tokenEvent(1, 200, 20, "child"),
    ], "child");
    const result = compareCodexV4V5([parent, child]);

    expect(result.forkEvidence.forkPairCount).toBe(1);
    expect(result.forkEvidence.pairs[0]).toMatchObject({
      parentSessionId: "parent",
      childSessionId: "child",
    });
    expect(result.forkEvidence.pairs[0]?.familyDelta).toBe(
      (result.forkEvidence.pairs[0]?.parentDelta ?? 0) + (result.forkEvidence.pairs[0]?.childDelta ?? 0),
    );
    expect(result.forkEvidence.unexplainedEventsOutsideForkFamilies).toBe(0);
  });
});
