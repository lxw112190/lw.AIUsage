import { describe, expect, it } from "vitest";
import { auditCodexPayloadUsageOverlap, collectTokenCountRefs } from "./payloadUsageOverlap";
import type { CodexExtractedEvent, CodexExtractedFile } from "./rawAuditTypes";

const entry = (path: string) => ({ path, name: path.split("/").at(-1) ?? path, isFile: true, isDirectory: false, size: 1, modifiedAt: 1 });
const counters = (input: number, output = 0) => ({ input_tokens: input, output_tokens: output });
const token = (index: number, timestamp: number, input: number, ids: Record<string, string> = {}, output = 0): CodexExtractedEvent => ({
  raw: { type: "event_msg", timestamp, payload: { type: "token_count", model: "gpt-5", ...ids, info: { last_token_usage: counters(input, output) } } },
  eventIndex: index,
  eventType: "token_count",
  semanticType: "token_count",
  isTokenCount: true,
  resolvedModel: "gpt-5",
  resolvedSessionId: "session",
  source: "token-count",
});
const payload = (index: number, timestamp: number, input: number, ids: Record<string, string> = {}): CodexExtractedEvent => ({
  raw: { type: "response.completed", timestamp, payload: { model: "gpt-5", ...ids, usage: counters(input) } },
  eventIndex: index,
  eventType: "response.completed",
  semanticType: "response.completed",
  isTokenCount: false,
  resolvedModel: "gpt-5",
  resolvedSessionId: "session",
  source: "payload-usage",
});
const rawPayload = (
  index: number,
  timestamp: number,
  usage: Record<string, unknown>,
  resolvedModel: string | undefined,
): CodexExtractedEvent => ({
  raw: { type: "response.completed", timestamp, payload: { usage } },
  eventIndex: index,
  eventType: "response.completed",
  semanticType: "response.completed",
  isTokenCount: false,
  resolvedModel,
  resolvedSessionId: "session",
  source: "payload-usage",
});
const totalToken = (index: number, timestamp: number, input: number): CodexExtractedEvent => ({
  raw: { type: "token_count", timestamp, payload: { model: "gpt-5", info: { total_token_usage: counters(input) } } },
  eventIndex: index,
  eventType: "token_count",
  semanticType: "token_count",
  isTokenCount: true,
  resolvedModel: "gpt-5",
  resolvedSessionId: "session",
  source: "token-count",
});
const shadowedPayload = (index: number, timestamp: number, input: number): CodexExtractedEvent => ({
  raw: { type: "token_count", timestamp, payload: { model: "gpt-5", usage: counters(input), info: { last_token_usage: counters(input) } } },
  eventIndex: index,
  eventType: "token_count",
  semanticType: "token_count",
  isTokenCount: true,
  resolvedModel: "gpt-5",
  resolvedSessionId: "session",
  source: "token-count",
});
const file = (events: CodexExtractedEvent[]): CodexExtractedFile => ({ entry: entry("/fixture/session.jsonl"), snapshotSize: 1, finalSessionId: "session", events });

describe("Codex payload usage overlap", () => {
  it("uses evidence levels, one-to-one matching, and preserves the token invariant", () => {
    const report = auditCodexPayloadUsageOverlap([file([
      token(0, 1_700_000_000_000, 10, { response_id: "r1" }),
      payload(1, 1_700_000_000_000, 10, { response_id: "r1" }),
      token(2, 1_700_000_001_000, 20, { turn_id: "t1" }),
      payload(3, 1_700_000_001_000, 20, { turn_id: "t1" }),
      token(4, 1_700_000_002_000, 30),
      payload(5, 1_700_000_002_500, 30),
      token(6, 1_700_000_003_000, 40),
      payload(7, 1_700_000_008_000, 40),
      token(8, 1_700_000_009_000, 50),
      token(9, 1_700_000_009_500, 15, {}, 5),
      payload(10, 1_700_000_009_500, 20),
      payload(11, 1_700_000_009_600, 50),
      token(12, 1_700_000_019_000, 60),
      token(13, 1_700_000_019_500, 60),
      payload(14, 1_700_000_019_400, 60),
    ])]);

    expect(report.duplicateClassification.confirmed.events).toBe(1);
    expect(report.duplicateClassification.probable.events).toBe(3);
    expect(report.duplicateClassification.possible.events).toBe(1);
    expect(report.duplicateClassification.ambiguous.events).toBe(1);
    expect(report.duplicateClassification.weakCandidate.events).toBe(1);
    expect(report.linkSummary.exact.events).toBe(1);
    expect(report.linkSummary.probable.events).toBe(3);
    expect(report.linkSummary.possible.events).toBe(1);
    expect(report.linkSummary.weak.events).toBe(1);
    expect(report.byEvidence["same-total-near-time"]?.events).toBe(1);
    expect(report.payloadTokenInvariant).toBe(true);
    expect(report.payloadUniverse.parserV4Eligible.tokens).toBe(10 + 20 + 30 + 40 + 20 + 50 + 60);
    expect(report.payloadUniverse.parserV4Eligible.tokens).toBe(
      Object.values(report.duplicateClassification).reduce((sum, count) => sum + count.tokens, 0),
    );
  });

  it("derives total-only TokenCount contributions instead of matching cumulative snapshots", () => {
    const refs = collectTokenCountRefs([file([
      totalToken(0, 1_700_000_000_000, 100),
      totalToken(1, 1_700_000_001_000, 150),
      totalToken(2, 1_700_000_002_000, 150),
      totalToken(3, 1_700_000_003_000, 50),
    ])]);

    expect(refs.map((ref) => ref.usage.inputTokens)).toEqual([100, 50, 0, 50]);
    expect(refs.map((ref) => ref.hasTokenContribution)).toEqual([true, true, false, true]);
  });

  it("separates observed payload usage from parser-v4-eligible payload usage", () => {
    const report = auditCodexPayloadUsageOverlap([file([
      shadowedPayload(0, 1_700_000_000_000, 100),
      payload(1, 1_700_000_001_000, 50),
    ])]);

    expect(report.payloadUniverse.observed).toEqual({ events: 2, tokens: 150 });
    expect(report.payloadUniverse.parserV4Eligible).toEqual({ events: 1, tokens: 50 });
    expect(report.payloadUniverse.shadowedByHigherPriority).toEqual({ events: 1, tokens: 100 });
    expect(report.payloadUniverseEventInvariant).toBe(true);
    expect(report.payloadUniverseTokenInvariant).toBe(true);
  });

  it("applies the parser-v4 payload gate without treating shadowed usage as eligible", () => {
    const report = auditCodexPayloadUsageOverlap([file([
      rawPayload(0, 1_700_000_000_000, counters(100), undefined),
      rawPayload(1, 1_700_000_001_000, { cache_creation_input_tokens: 50 }, "gpt-5"),
    ])]);

    expect(report.payloadUniverse.observed).toEqual({ events: 2, tokens: 150 });
    expect(report.payloadUniverse.parserV4Eligible).toEqual({ events: 0, tokens: 0 });
    expect(report.payloadUniverse.shadowedByHigherPriority).toEqual({ events: 2, tokens: 150 });
    expect(report.payloadUniverseEventInvariant).toBe(true);
    expect(report.payloadUniverseTokenInvariant).toBe(true);
  });

  it("is independent of payload order and lets strong evidence win first", () => {
    const token = tokenCountWithResponse("r-strong");
    const weak = payload(1, 1_700_000_000_500, 100);
    const strong = payload(2, 1_700_000_000_500, 100, { response_id: "r-strong" });
    const first = auditCodexPayloadUsageOverlap([file([token, weak, strong])]);
    const second = auditCodexPayloadUsageOverlap([file([token, strong, weak])]);

    expect(first.duplicateClassification.confirmed).toEqual({ events: 1, tokens: 100 });
    expect(first.duplicateClassification.unmatched).toEqual({ events: 1, tokens: 100 });
    expect(first.linkedTokens).toBe(100);
    expect(first.candidateLinkedTokens).toBe(100);
    expect(first.samples).toEqual(second.samples);
    expect(first.duplicateClassification).toEqual(second.duplicateClassification);
  });

  it("requires mutual uniqueness and narrows response candidates by usage", () => {
    const ambiguous = auditCodexPayloadUsageOverlap([file([
      tokenCountWithResponse("r-many"),
      payload(1, 1_700_000_000_000, 100, { response_id: "r-many" }),
      payload(2, 1_700_000_000_001, 100, { response_id: "r-many" }),
    ])]);
    expect(ambiguous.duplicateClassification.ambiguous.events).toBe(2);

    const narrowed = auditCodexPayloadUsageOverlap([file([
      token(0, 1_700_000_000_000, 10, { response_id: "r-narrow" }),
      token(1, 1_700_000_000_001, 100, { response_id: "r-narrow" }),
      payload(2, 1_700_000_000_002, 100, { response_id: "r-narrow" }),
    ])]);
    expect(narrowed.duplicateClassification.confirmed.events).toBe(1);
    expect(narrowed.duplicateClassification.confirmed.tokens).toBe(100);
  });

  it("allows later evidence to narrow a strong candidate domain", () => {
    const report = auditCodexPayloadUsageOverlap([file([
      token(0, 1_700_000_000_000, 90, { response_id: "r-domain", turn_id: "t-domain" }),
      token(1, 1_700_000_000_001, 110, { response_id: "r-domain", turn_id: "t-other" }),
      payload(2, 1_700_000_000_002, 100, { response_id: "r-domain", turn_id: "t-domain" }),
    ])]);

    expect(report.linkSummary.probable).toEqual({ events: 1, tokens: 100 });
    expect(report.samples[0]?.evidence).toBe("same-turn-id");
    expect(report.samples[0]?.linkConfidence).toBe("probable");
  });

  it("does not let weak evidence escape a strong ambiguous candidate domain", () => {
    const report = auditCodexPayloadUsageOverlap([file([
      token(0, 1_700_000_000_000, 90, { response_id: "r-ambiguous" }),
      token(1, 1_700_000_000_001, 110, { response_id: "r-ambiguous" }),
      token(2, 1_700_000_000_002, 95, { response_id: "r-other" }, 5),
      payload(3, 1_700_000_000_003, 100, { response_id: "r-ambiguous" }),
    ])]);

    expect(report.duplicateClassification.ambiguous).toEqual({ events: 1, tokens: 100 });
    expect(report.samples[0]?.evidence).toBe("same-response-id");
    expect(report.samples[0]?.linkConfidence).toBe("ambiguous");
  });

  it("classifies a weak multi-candidate match as ambiguous", () => {
    const report = auditCodexPayloadUsageOverlap([file([
      token(0, 1_700_000_000_000, 90, {}, 10),
      token(1, 1_700_000_000_001, 80, {}, 20),
      payload(2, 1_700_000_000_002, 100),
    ])]);

    expect(report.duplicateClassification.ambiguous).toEqual({ events: 1, tokens: 100 });
    expect(report.linkSummary.ambiguous).toEqual({ events: 1, tokens: 100 });
    expect(report.samples[0]?.evidence).toBe("same-total-near-time");
  });
});

const tokenCountWithResponse = (responseId: string): CodexExtractedEvent => token(0, 1_700_000_000_000, 100, { response_id: responseId });
