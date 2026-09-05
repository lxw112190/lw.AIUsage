import { describe, expect, it } from "vitest";
import { createFixturePlatform } from "@lw-aiusage/platform";
import { auditCodexRaw } from "./rawAudit";

const event = (sessionId: string, total: number, last: number, timestamp?: string): string =>
  JSON.stringify({ type: "token_count", timestamp, payload: { info: { total_token_usage: { input_tokens: total }, last_token_usage: { input_tokens: last } } } });

describe("Codex raw audit", () => {
  it("compares last usage with cumulative deltas and detects snapshots", async () => {
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/a.jsonl": [
        JSON.stringify({ type: "session_meta", payload: { id: "a", timestamp: "2026-09-01T10:00:00Z" } }),
        event("a", 1000, 1000, "2026-09-01T10:01:00Z"),
        event("a", 1800, 800, "2026-09-01T10:02:00Z"),
        event("a", 1800, 800, "2026-09-01T10:03:00Z"),
      ].join("\n") + "\n",
      "/fixture/.codex/sessions/b.jsonl": [
        JSON.stringify({ type: "session_meta", payload: { id: "b", timestamp: "2026-09-02T10:00:00Z" } }),
        event("b", 1000, 1000),
        event("b", 300, 0),
        event("b", 700, 400),
      ].join("\n") + "\n",
    });
    const report = await auditCodexRaw(platform);
    expect(report.files).toBe(2);
    expect(report.sessions).toBe(2);
    expect(report.events.tokenCount).toBe(6);
    expect(report.events.repeatedTotalSnapshot).toBe(1);
    expect(report.events.repeatedTotalWithNonZeroLast).toBe(1);
    expect(report.events.totalCounterDecrease).toBe(1);
    expect(report.methods.lastUsageSum.inputTokens).toBe(4000);
    expect(report.methods.totalDeltaSum.inputTokens).toBe(3500);
    expect(report.discrepancy.repeatedLastTokens).toBe(800);
    expect(report.peakDays).toHaveLength(2);
    expect(report.timestampSources.session).toBe(1);
    expect(report.timestampSources.inherited).toBe(2);
    expect(report.events.missingTimestamp).toBe(3);
  });
});
