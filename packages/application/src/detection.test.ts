import { describe, expect, it } from "vitest";
import { defaultCollectors } from "@lw-aiusage/collectors";
import { createFixturePlatform } from "@lw-aiusage/platform";
import { detectCollectors } from "./detection";

describe("detectCollectors", () => {
  it("distinguishes installed agents with and without data", async () => {
    const platform = createFixturePlatform({
      "/fixture/.codex/sessions/demo.jsonl": "{}\n",
      "/fixture/.claude/projects/demo/session.jsonl": "{}\n",
    });

    const results = await detectCollectors(platform, defaultCollectors());

    expect(results.map((result) => [result.source, result.status])).toEqual([
      ["codex", "Active"],
      ["claude", "Active"],
    ]);
  });

  it("reports an absent agent as not detected", async () => {
    const results = await detectCollectors(
      createFixturePlatform({}),
      defaultCollectors(),
    );
    expect(results.every((result) => result.status === "NotDetected")).toBe(
      true,
    );
  });

  it("reports an installed agent without usage files as ready", async () => {
    const results = await detectCollectors(
      createFixturePlatform({ "/fixture/.codex/config.toml": "" }),
      defaultCollectors(),
    );
    expect(results.find((result) => result.source === "codex")?.status).toBe(
      "Ready",
    );
  });
});
