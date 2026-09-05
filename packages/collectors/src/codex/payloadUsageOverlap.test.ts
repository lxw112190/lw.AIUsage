import { describe, expect, it } from "vitest";
import { auditCodexPayloadUsageOverlap } from "./payloadUsageOverlap";
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

    expect(report.exact.events).toBe(2);
    expect(report.probable.events).toBe(2);
    expect(report.possible.events).toBe(1);
    expect(report.ambiguous.events).toBe(1);
    expect(report.unmatched.events).toBe(1);
    expect(report.byEvidence["same-total-near-time"]?.events).toBe(1);
    expect(report.payloadTokenInvariant).toBe(true);
    expect(report.payloadTokens).toBe(10 + 20 + 30 + 40 + 20 + 50 + 60);
    expect(report.payloadTokens).toBe(
      report.exact.tokens + report.probable.tokens + report.possible.tokens + report.ambiguous.tokens + report.unmatched.tokens,
    );
  });
});
