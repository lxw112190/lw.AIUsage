import { describe, expect, it } from "vitest";
import { createFixturePlatform } from "@lw-aiusage/platform";
import { extractCodexFile, peekCodexSessionMeta } from "./rawExtractor";

const entry = (path: string, size: number) => ({ path, name: path.split("/").at(-1) ?? path, isFile: true, isDirectory: false, size, modifiedAt: 1 });

describe("Codex raw extractor protocol boundaries", () => {
  it("keeps nested session_meta out of the collector outer-type identity", async () => {
    const content = `${JSON.stringify({ type: "event_msg", payload: { type: "session_meta", id: "nested" } })}\n`;
    const platform = createFixturePlatform({ "/fixture/session.jsonl": content });
    const fileEntry = entry("/fixture/session.jsonl", content.length);

    expect(await peekCodexSessionMeta(platform, fileEntry)).toEqual({});
    const extracted = await extractCodexFile(platform, fileEntry);
    expect(extracted.peekLogicalId).toBeUndefined();
    expect(extracted.events[0]?.eventType).toBe("event_msg");
    expect(extracted.events[0]?.semanticType).toBe("session_meta");
  });

  it("preserves malformed JSONL diagnostics alongside decoded events", async () => {
    const content = [
      JSON.stringify({ type: "response_item", payload: { text: "ok" } }),
      "not-json",
      JSON.stringify({ type: "response_item", payload: { text: "also ok" } }),
      "",
    ].join("\n");
    const platform = createFixturePlatform({ "/fixture/errors.jsonl": content });
    const extracted = await extractCodexFile(platform, entry("/fixture/errors.jsonl", content.length));

    expect(extracted.events).toHaveLength(2);
    expect(extracted.parseErrors).toEqual(["MALFORMED_JSONL"]);
  });
});
