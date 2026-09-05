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
    expect(report.timestampSources.session).toBe(0);
    expect(report.timestampSources.inherited).toBe(3);
    expect(report.events.missingTimestamp).toBe(3);
    expect(report.accounting).toBe("codex-accounting-audit-v3");
    expect(report.eventClasses["duplicate-snapshot"]).toBe(1);
  });

  it("detects a component reset even when the raw total still increases", async () => {
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/reset.jsonl": [
        JSON.stringify({ type: "session_meta", payload: { id: "reset", timestamp: "2026-09-01T10:00:00Z" } }),
        JSON.stringify({ type: "token_count", timestamp: "2026-09-01T10:01:00Z", payload: { info: { total_token_usage: { input_tokens: 1000, output_tokens: 100, total_tokens: 1100 } } } }),
        JSON.stringify({ type: "token_count", timestamp: "2026-09-01T10:02:00Z", payload: { info: { total_token_usage: { input_tokens: 900, output_tokens: 300, total_tokens: 1200 } } } }),
      ].join("\n") + "\n",
    });
    const report = await auditCodexRaw(platform);
    expect(report.events.totalCounterDecrease).toBe(0);
    expect(report.anomalies.componentCounterDecrease).toBe(1);
    expect(report.eventClasses["counter-reset"]).toBe(1);
    expect(report.resets.count).toBe(1);
    expect(report.resets.items[0]?.resetComponents).toContain("input");
  });

  it("keeps a UTF-8 character intact when it crosses the 1 MiB chunk boundary", async () => {
    const encoder = new TextEncoder();
    const boundary = 1024 * 1024;
    const meta = `${JSON.stringify({ type: "session_meta", payload: { id: "utf8" } })}\n`;
    const linePrefix = '{"type":"noise","message":"';
    const lineSuffix = '"}\n';
    const targetPrefixBytes = boundary - 1;
    const fixedBytes = encoder.encode(meta).byteLength + encoder.encode(linePrefix).byteLength;
    const fillerLines = Math.floor((targetPrefixBytes - fixedBytes) / 3);
    let content = meta + "{}\n".repeat(fillerLines);
    const remainingBytes = targetPrefixBytes - encoder.encode(content).byteLength - encoder.encode(linePrefix).byteLength;
    content += "\n".repeat(Math.max(remainingBytes, 0));
    content += `${linePrefix}中${lineSuffix}${event("utf8", 100, 100, "2026-09-01T10:01:00Z")}\n`;
    const platform = createFixturePlatform({ "/fixture/.codex/sessions/utf8.jsonl": content });
    const report = await auditCodexRaw(platform);
    expect(report.events.tokenCount).toBe(1);
    expect(report.methods.lastUsageSum.inputTokens).toBe(100);
  });

  it("uses the child-first baseline so parent growth after fork is excluded", async () => {
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/parent.jsonl": [
        JSON.stringify({ type: "session_meta", payload: { id: "parent", timestamp: "2026-09-01T10:00:00Z" } }),
        event("parent", 1000, 1000, "2026-09-01T10:01:00Z"),
        event("parent", 2000, 1000, "2026-09-01T10:03:00Z"),
      ].join("\n") + "\n",
      "/fixture/.codex/sessions/child.jsonl": [
        JSON.stringify({ type: "session_meta", payload: { id: "child", forked_from_id: "parent", timestamp: "2026-09-01T10:02:00Z" } }),
        event("child", 1200, 200, "2026-09-01T10:02:01Z"),
        event("child", 1500, 300, "2026-09-01T10:04:00Z"),
      ].join("\n") + "\n",
    });
    const report = await auditCodexRaw(platform);
    expect(report.fork.childFirstLastResolved).toBe(1);
    expect(report.fork.parentAtForkResolved).toBe(0);
    expect(report.methods.forkAwareTotalDelta.inputTokens).toBe(2500);
    expect(report.methods.currentEquivalent.inputTokens).toBe(2300);
  });

  it("audits every usage source covered by the v4 parser", async () => {
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/sources.jsonl": [
        JSON.stringify({ type: "session_meta", payload: { id: "sources" } }),
        JSON.stringify({ type: "token_count", payload: { info: { last_token_usage: { input_tokens: 10 } } } }),
        JSON.stringify({ type: "turn_context", payload: { info: { last_token_usage: { input_tokens: 20 } } } }),
        JSON.stringify({ type: "response.completed", payload: { usage: { input_tokens: 30 } } }),
        JSON.stringify({ type: "response.completed", payload: { input_tokens: 40 } }),
      ].join("\n") + "\n",
    });
    const report = await auditCodexRaw(platform);
    expect(report.usageSources.tokenCount.events).toBe(1);
    expect(report.usageSources.nestedInfoNonTokenCount.events).toBe(1);
    expect(report.usageSources.payloadUsage.events).toBe(1);
    expect(report.usageSources.flatPayloadUsage.events).toBe(1);
    expect(report.methods.parserEquivalentV4AllEvents.inputTokens).toBe(100);
    expect(report.methods.hybridCanonical.inputTokens).toBe(100);
  });
});
