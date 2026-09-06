import { describe, expect, it } from "vitest";
import { defaultCollectors } from "./registry";

describe("default collectors", () => {
  it("uses Codex parser v5 after the migration audit is complete", () => {
    const codex = defaultCollectors().find((collector) => collector.source === "codex");

    expect(codex?.parserVersion).toBe(5);
    expect(codex?.name).toBe("Codex");
  });
});
