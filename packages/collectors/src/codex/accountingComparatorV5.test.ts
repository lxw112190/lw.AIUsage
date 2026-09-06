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
});
