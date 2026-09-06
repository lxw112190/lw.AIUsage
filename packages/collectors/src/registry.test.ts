import { describe, expect, it } from "vitest";
import { defaultCollectors } from "./registry";

describe("default collectors", () => {
  it("keeps Codex parser v4 in production while v5 semantic validation is pending", () => {
    const codex = defaultCollectors().find((collector) => collector.source === "codex");

    expect(codex?.parserVersion).toBe(4);
    expect(codex?.name).toBe("Codex");
  });
});
