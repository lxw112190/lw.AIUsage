import { describe, expect, it } from "vitest";
import {
  codexTimestampV5,
  decodeCodexFileV5,
  responseIdOf,
  stableCodexEventJsonV5,
  turnIdOf,
} from "./eventDecoderV5";

describe("Codex v5 event decoder", () => {
  it("decodes session, fork, timestamp, model, project and token fields", () => {
    const result = decodeCodexFileV5({
      sourcePath: "/sessions/child.jsonl",
      values: [
        {
          type: "session_meta",
          timestamp: 1000,
          payload: { id: "child", forked_from_id: "parent", cwd: "/repo" },
        },
        {
          type: "event_msg",
          timestamp: 1001,
          payload: {
            type: "token_count",
            model: "gpt-5",
            info: {
              last_token_usage: { input_tokens: 10, output_tokens: 2 },
              total_token_usage: { total_tokens: 12 },
            },
            response_id: "response-1",
            turn_id: "turn-1",
          },
        },
      ],
    });

    expect(result.sessionId).toBe("child");
    expect(result.parentSessionId).toBe("parent");
    expect(result.forkTimestamp).toBe(1_000_000);
    expect(result.events[1]).toMatchObject({
      sessionId: "child",
      parentSessionId: "parent",
      timestamp: 1_001_000,
      model: "gpt-5",
      projectKey: "/repo",
      responseId: "response-1",
      turnId: "turn-1",
      semanticType: "token_count",
    });
    expect(result.events[1]?.tokenCount?.last?.input).toBe(10);
    expect(result.events[1]?.tokenCount?.total?.total).toBe(12);
    expect(result.diagnostics.tokenCountEvents).toBe(1);
  });

  it("supports nested msg protocol fields and ISO or millisecond timestamps", () => {
    const nested = {
      type: "event_msg",
      payload: {
        msg: {
          type: "token_count",
          timestamp: "2025-01-02T03:04:05.000Z",
          sessionId: "nested-session",
          model: "gpt-nested",
          cwd: "/nested",
          responseId: "r",
          turnId: "t",
          info: { lastTokenUsage: { inputTokens: 5, outputTokens: 1 } },
        },
      },
    };

    const result = decodeCodexFileV5({ sourcePath: "/nested.jsonl", values: [nested] });

    expect(result.events[0]).toMatchObject({
      sessionId: "nested-session",
      timestamp: Date.parse("2025-01-02T03:04:05.000Z"),
      model: "gpt-nested",
      projectKey: "/nested",
      responseId: "r",
      turnId: "t",
    });
    expect(codexTimestampV5({ timestamp: 1_700_000_000_000 })).toBe(1_700_000_000_000);
    expect(responseIdOf(nested)).toBe("r");
    expect(turnIdOf(nested)).toBe("t");
  });

  it("keeps token_count and payload usage on the same raw event", () => {
    const result = decodeCodexFileV5({
      sourcePath: "/same.jsonl",
      values: [{
        type: "token_count",
        timestamp: 10,
        payload: {
          info: { last_token_usage: { input_tokens: 10, output_tokens: 1 } },
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      }],
    });

    expect(result.events[0]?.tokenCount).toBeDefined();
    expect(result.events[0]?.payloadUsage).toBeDefined();
    expect(result.diagnostics.payloadUsageEvents).toBe(1);
  });

  it("falls through an invalid usage alias to a later valid alias", () => {
    const result = decodeCodexFileV5({
      sourcePath: "/sessions/a.jsonl",
      values: [{
        type: "token_count",
        timestamp: 100,
        payload: {
          info: {
            last_token_usage: { input_tokens: "invalid" },
            lastTokenUsage: { inputTokens: 10, outputTokens: 2 },
            total_token_usage: { total_tokens: "invalid" },
            totalTokenUsage: { totalTokens: 12 },
          },
        },
      }],
    });

    expect(result.events[0]?.tokenCount?.last?.input).toBe(10);
    expect(result.events[0]?.tokenCount?.last?.output).toBe(2);
    expect(result.events[0]?.tokenCount?.total?.total).toBe(12);
  });

  it("uses legacy flat usage only on non-token events and diagnoses nested non-token usage", () => {
    const result = decodeCodexFileV5({
      sourcePath: "/legacy.jsonl",
      values: [
        { type: "response_item", timestamp: 10, payload: { input_tokens: 4, output_tokens: 1 } },
        { type: "event_msg", payload: { info: { last_token_usage: { input_tokens: 8 } } } },
        { type: "token_count", payload: { input_tokens: 100 } },
      ],
    });

    expect(result.diagnostics.legacyFlatUsageEvents).toBe(1);
    expect(result.diagnostics.nestedUsageOnNonTokenEvents).toBe(1);
    expect(result.events[2]?.payloadUsage).toBeUndefined();
    expect(result.diagnostics.tokenCountEvents).toBe(1);
  });

  it("never invents timestamps and distinguishes duplicate persisted events", () => {
    const values = [{ type: "token_count", payload: { info: { last_token_usage: { input_tokens: 1 } } } }];
    const result = decodeCodexFileV5({ sourcePath: "/missing.jsonl", values: [...values, ...values] });

    expect(result.events[0]?.timestamp).toBeUndefined();
    expect(result.events[0]?.rawIdentity).not.toBe(result.events[1]?.rawIdentity);
    expect(result.diagnostics.missingTimestampEvents).toBe(2);
  });

  it("makes raw fingerprints stable across object key order and path independent", () => {
    const first = decodeCodexFileV5({ sourcePath: "/sessions/a.jsonl", values: [{ b: 2, a: { y: 2, x: 1 } }] });
    const second = decodeCodexFileV5({ sourcePath: "/archived_sessions/a.jsonl", values: [{ a: { x: 1, y: 2 }, b: 2 }] });

    expect(first.events[0]?.rawIdentity).toBe(second.events[0]?.rawIdentity);
    expect(stableCodexEventJsonV5({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("backfills a session discovered after early usage events", () => {
    const result = decodeCodexFileV5({
      sourcePath: "/late-meta.jsonl",
      logicalIdHint: "hint",
      values: [
        { type: "token_count", payload: { info: { last_token_usage: { input_tokens: 3, output_tokens: 0 } } } },
        { type: "session_meta", payload: { id: "actual" } },
      ],
    });

    expect(result.sessionId).toBe("actual");
    expect(result.events[0]?.sessionId).toBe("actual");
  });
});
