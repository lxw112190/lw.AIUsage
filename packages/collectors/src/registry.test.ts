import { describe, expect, it } from "vitest";
import { defaultCollectors } from "./registry";

describe("default collectors", () => {
  it("uses the source-wide Codex parser v5 in production", () => {
    const codex = defaultCollectors().find((collector) => collector.source === "codex");

    expect(codex?.parserVersion).toBe(5);
    expect(codex?.scanMode).toBe("source");
    expect(codex?.name).toBe("Codex");
  });
});
