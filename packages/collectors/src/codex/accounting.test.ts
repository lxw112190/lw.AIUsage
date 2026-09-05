import { describe, expect, it } from "vitest";
import { counterDecrease, sameRawCounters, subtractRawCounters, type CodexRawCounters } from "./accounting";

const counters = (values: Partial<CodexRawCounters>): CodexRawCounters => ({ input: 0, cachedInput: 0, cacheCreationInput: 0, output: 0, reasoningOutput: 0, total: 0, ...values });

describe("Codex raw counter accounting", () => {
  it("subtracts each raw counter before normalization", () => {
    expect(subtractRawCounters(counters({ input: 180, cachedInput: 30, output: 90, total: 270 }), counters({ input: 100, cachedInput: 20, output: 40, total: 140 }))).toEqual({ input: 80, cachedInput: 10, cacheCreationInput: 0, output: 50, reasoningOutput: 0, total: 130 });
  });

  it("detects component decreases independently from total", () => {
    const previous = counters({ input: 1000, output: 100, total: 1100 });
    const current = counters({ input: 900, output: 300, total: 1200 });
    expect(counterDecrease(current, previous)).toBe(true);
    expect(sameRawCounters(current, previous)).toBe(false);
  });

  it("compares the cumulative components and ignores the derived total field", () => {
    expect(sameRawCounters(counters({ input: 100, total: 100 }), counters({ input: 100, total: 999 }))).toBe(true);
  });
});
