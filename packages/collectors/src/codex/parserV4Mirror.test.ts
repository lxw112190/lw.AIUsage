import { describe, expect, it } from "vitest";
import { totalTokens } from "@lw-aiusage/core";
import { createFixturePlatform } from "@lw-aiusage/platform";
import type { FileEntry } from "@lw-aiusage/platform";
import { stableEventId } from "../shared/identity";
import { extractCodexFile } from "./rawExtractor";
import { replayCodexV4 } from "./parserV4Mirror";
import type { CodexExtractedEvent, CodexExtractedFile } from "./rawAuditTypes";

const entry = (path: string): FileEntry => ({
  path,
  name: path.split("/").at(-1) ?? path,
  isFile: true,
  isDirectory: false,
  size: 1,
  modifiedAt: 1,
});

const counters = (input: number) => ({
  input,
  cachedInput: 0,
  cacheCreationInput: 0,
  output: 0,
  reasoningOutput: 0,
  total: 0,
});

const event = (
  path: string,
  index: number,
  payload: Record<string, unknown>,
  total?: number,
  last?: number,
): CodexExtractedEvent => ({
  raw: {
    type: "token_count",
    payload: {
      ...payload,
      info: {
        ...(typeof payload.info === "object" && payload.info !== null ? payload.info : {}),
        ...(total === undefined ? {} : { total_token_usage: { input_tokens: total } }),
        ...(last === undefined ? {} : { last_token_usage: { input_tokens: last } }),
      },
    },
  },
  eventIndex: index,
  eventType: "token_count",
  total: total === undefined ? undefined : counters(total),
  last: last === undefined ? undefined : counters(last),
  source: "token-count",
});

const file = (path: string, events: CodexExtractedEvent[]): CodexExtractedFile => ({
  entry: entry(path),
  snapshotSize: 1,
  events,
});

describe("Codex Parser v4 mirror", () => {
  it("does not advance cumulative state for ignored no-model events", () => {
    const result = replayCodexV4([
      file("/fixture/.codex/sessions/a.jsonl", [
        event("a", 0, { info: {} }, 1_500, 500),
        event("a", 1, { model: "gpt-5", info: {} }, 1_800),
      ]),
    ]);

    expect(result.recordCount).toBe(1);
    expect(result.usage.inputTokens).toBe(1_800);
    expect([...result.records.values()].map((record) => record.usage.inputTokens)).toEqual([1_800]);
  });

  it("uses the Collector 64 KiB peek logical id boundary", async () => {
    const padding = "x".repeat(70_000);
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/late.jsonl": [
        JSON.stringify({ type: "token_count", payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 10 } }, padding } }),
        JSON.stringify({ type: "session_meta", payload: { id: "late-session", model: "gpt-5" } }),
        JSON.stringify({ type: "token_count", payload: { model: "gpt-5", info: { last_token_usage: { input_tokens: 20 } } } }),
      ].join("\n") + "\n",
    });
    const files = await platform.fs.list("/fixture/.codex/sessions");
    const extracted = await extractCodexFile(platform, files[0]!);
    const result = replayCodexV4([extracted]);
    const records = [...result.records.values()];

    expect(extracted.peekLogicalId).toBeUndefined();
    expect(records).toHaveLength(2);
    expect(records[0]!.id).not.toBe(records[1]!.id);
    expect(records[0]!.id).toContain("h");
    expect(records[1]!.id).toContain("h");
  });

  it("keeps only the last record when a stable event id is repeated", () => {
    const first = event("a", 0, { model: "gpt-5", info: { last_token_usage: { input_tokens: 100 } } }, undefined, 100);
    const second = event("a", 1, { model: "gpt-5", info: { last_token_usage: { input_tokens: 180 } } }, undefined, 180);
    first.raw.uuid = "same-event";
    second.raw.uuid = "same-event";
    const result = replayCodexV4([file("/fixture/.codex/sessions/a.jsonl", [first, second])]);

    expect(result.recordCount).toBe(1);
    expect(result.usage.inputTokens).toBe(180);
  });

  it("hashes the original protocol node for fallback stable ids", () => {
    const raw = {
      type: "token_count",
      payload: {
        model: "gpt-5",
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 80,
            reasoning_output_tokens: 4,
          },
        },
      },
    };
    const extracted: CodexExtractedEvent = {
      raw,
      eventIndex: 0,
      eventType: "token_count",
      total: { input: 100, cachedInput: 80, cacheCreationInput: 0, output: 0, reasoningOutput: 4, total: 0 },
      source: "token-count",
    };
    const result = replayCodexV4([file("/fixture/a.jsonl", [extracted])]);
    const expected = stableEventId("codex", "/fixture/a.jsonl", raw, {
      timestamp: undefined,
      turnId: undefined,
      responseId: undefined,
      total: raw.payload.info.total_token_usage,
    });

    expect([...result.records.keys()]).toEqual([expected]);
  });

  it("freezes the current v4 usage-field gate", () => {
    const onlyCacheCreation: CodexExtractedEvent = {
      raw: {
        type: "token_count",
        payload: {
          model: "gpt-5",
          info: { total_token_usage: { cache_creation_input_tokens: 100 } },
        },
      },
      eventIndex: 0,
      eventType: "token_count",
      total: counters(0),
      source: "token-count",
    };

    expect(replayCodexV4([file("/fixture/cache.jsonl", [onlyCacheCreation])]).recordCount).toBe(0);
  });

  it("resolves fork baseline in file scan order and aggregates every dimension", () => {
    const result = replayCodexV4([
      file("/fixture/.codex/sessions/a-parent.jsonl", [
        event("parent", 0, { model: "gpt-5", session_id: "parent" }, 1_000),
      ]),
      file("/fixture/.codex/sessions/z-child.jsonl", [
        { raw: { type: "session_meta", payload: { id: "child", forked_from_id: "parent", model: "gpt-5" } }, eventIndex: 0, eventType: "session_meta" },
        event("child", 1, { model: "gpt-5", session_id: "child", forked_from_id: "parent" }, 1_200, 200),
      ]),
    ]);

    expect(result.usage.inputTokens).toBe(1_200);
    expect(result.sessions.get("parent")?.usage.inputTokens).toBe(1_000);
    expect(result.sessions.get("child")?.usage.inputTokens).toBe(200);
    expect([...result.days.values()].reduce((sum, value) => sum + totalTokens(value), 0)).toBe(totalTokens(result.usage));
    expect(Object.values(result.sources).reduce((sum, value) => sum + totalTokens(value), 0)).toBe(totalTokens(result.usage));
    expect([...result.sessions.values()].reduce((sum, value) => sum + totalTokens(value.usage), 0)).toBe(totalTokens(result.usage));
  });

  it("canonicalizes logical-singleton files using the Collector winner rule", () => {
    const smaller = file("/fixture/.codex/sessions/A.jsonl", [event("A", 0, { model: "gpt-5", session_id: "A" }, 100)]);
    smaller.peekLogicalId = "A";
    smaller.entry.size = 10;
    const archived = file("/fixture/.codex/archived_sessions/A.jsonl", [event("A", 0, { model: "gpt-5", session_id: "A" }, 200)]);
    archived.peekLogicalId = "A";
    archived.entry.size = 10;
    const larger = file("/fixture/.codex/sessions/A-copy.jsonl", [event("A", 0, { model: "gpt-5", session_id: "A" }, 300)]);
    larger.peekLogicalId = "A";
    larger.entry.size = 20;

    const result = replayCodexV4([smaller, archived, larger]);

    expect(result.discoveredFileCount).toBe(3);
    expect(result.canonicalFileCount).toBe(1);
    expect(result.shadowDuplicateCount).toBe(2);
    expect(result.usage.inputTokens).toBe(300);
  });
});
