import { describe, expect, it } from "vitest";
import type { CollectorFile } from "../types";
import { createFixturePlatform } from "@lw-aiusage/platform";
import { readCodexSourceFileV5 } from "./sourceReaderV5";

const makeFile = (path: string, size: number): CollectorFile => ({
  path,
  name: path.split("/").at(-1) ?? path,
  isFile: true,
  isDirectory: false,
  size,
  modifiedAt: 1,
  source: "codex",
  logicalId: "session-a",
});

describe("Codex V5 source reader", () => {
  it("reads exactly the discovered snapshot size and keeps a trailing partial line pending", async () => {
    const first = JSON.stringify({ type: "session_meta", payload: { id: "session-a" } });
    const second = JSON.stringify({ type: "token_count", timestamp: 100, payload: { model: "gpt-5" } });
    const content = `${first}\n${second}\n`;
    const firstSize = new TextEncoder().encode(`${first}\n`).byteLength;
    const platform = createFixturePlatform({ "/fixture/session.jsonl": content });
    const complete = await readCodexSourceFileV5({ platform }, makeFile("/fixture/session.jsonl", firstSize));

    expect(complete.values).toHaveLength(1);
    expect(complete.values[0]).toEqual(JSON.parse(first));
    expect(complete.hasPendingText).toBe(false);

    const partial = await readCodexSourceFileV5({ platform }, makeFile("/fixture/session.jsonl", firstSize + 8));
    expect(partial.values).toHaveLength(1);
    expect(partial.hasPendingText).toBe(true);
    expect(partial.parseErrors).toEqual([]);
  });

  it("preserves UTF-8 text while a JSON line crosses the read chunk boundary", async () => {
    const filler = "{}\n";
    const prefix = filler.repeat(Math.floor((1024 * 1024 - 20) / filler.length));
    const unicodeLine = JSON.stringify({ type: "response_item", payload: { text: `${"a".repeat(100)}瀑布` } });
    const content = `${prefix}${unicodeLine}\n`;
    const platform = createFixturePlatform({ "/fixture/utf8.jsonl": content });
    const file = makeFile("/fixture/utf8.jsonl", new TextEncoder().encode(content).byteLength);
    const result = await readCodexSourceFileV5({ platform }, file);

    expect(result.values.at(-1)).toEqual(expect.objectContaining({ payload: { text: `${"a".repeat(100)}瀑布` } }));
    expect(result.hasPendingText).toBe(false);
  });
});
