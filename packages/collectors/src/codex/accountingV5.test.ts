import { describe, expect, it } from "vitest";
import { totalTokens } from "@lw-aiusage/core";
import {
  compareRawCumulative,
  decodeRawTokenUsage,
  deduplicateTokenCountEvents,
  deriveTokenCountContribution,
  deterministicAccountingTimestamp,
  effectiveAggregateTotal,
  normalizeRawTokenUsage,
  tokenCountIdentity,
  type CodexAccountingEvent,
  type RawTokenUsage,
  type TokenCountState,
} from "./accountingV5";

const raw = (value: Record<string, unknown>): RawTokenUsage => {
  const result = decodeRawTokenUsage(value);
  if (!result) throw new Error("expected usage");
  return result;
};
const event = (
  rawIdentity: string,
  tokenCount: CodexAccountingEvent["tokenCount"],
  sessionId = "session",
): CodexAccountingEvent => ({
  sourcePath: "/fixture/session.jsonl",
  eventIndex: 0,
  sessionId,
  tokenCount,
  rawIdentity,
});
const state = (previousRaw?: RawTokenUsage, segment = 0): TokenCountState => ({
  previousTotalRaw: previousRaw,
  previousAggregateTotal: previousRaw ? effectiveAggregateTotal(previousRaw) : undefined,
  segment,
});

describe("Codex v5 accounting engine", () => {
  it("decodes aliases, preserves field presence, and applies cache-write precedence", () => {
    const decoded = raw({
      input_tokens: 100,
      cachedInputTokens: 20,
      cache_write_input_tokens: 7,
      cache_creation_input_tokens: 99,
      outputTokens: 40,
      reasoningOutputTokens: 5,
      totalTokens: 145,
    });

    expect(decoded).toMatchObject({
      input: 100,
      cachedInput: 20,
      cacheCreationInput: 7,
      output: 40,
      reasoningOutput: 5,
      total: 145,
      fieldPresence: {
        input: true,
        cachedInput: true,
        cacheCreationInput: true,
        output: true,
        reasoningOutput: true,
        total: true,
      },
    });
    expect(normalizeRawTokenUsage(decoded)).toEqual({
      inputTokens: 80,
      cachedInputTokens: 20,
      cacheCreationInputTokens: 7,
      outputTokens: 35,
      reasoningOutputTokens: 5,
    });
    expect(decodeRawTokenUsage({ input_tokens: 0 })?.fieldPresence.input).toBe(true);
    expect(raw({ input_tokens: null, inputTokens: 12 }).input).toBe(12);
    expect(raw({ cache_write_input_tokens: null, cache_creation_input_tokens: 4 }).cacheCreationInput).toBe(4);
    expect(decodeRawTokenUsage({})).toBeUndefined();
  });

  it("prefers last usage while still advancing the cumulative total state", () => {
    const contribution = deriveTokenCountContribution(
      event("last", { last: raw({ input_tokens: 20 }), total: raw({ input_tokens: 120 }) }),
      state(raw({ input_tokens: 100 })),
    );

    expect(contribution?.method).toBe("last");
    expect(contribution?.usage.inputTokens).toBe(20);
    expect(contribution?.nextState.previousTotalRaw?.input).toBe(120);
  });

  it("derives initial, delta, duplicate, and reset total-only contributions", () => {
    const initial = deriveTokenCountContribution(event("initial", { total: raw({ total_tokens: 100 }) }), state());
    const delta = deriveTokenCountContribution(event("delta", { total: raw({ total_tokens: 150 }) }), state(raw({ total_tokens: 100 })));
    const duplicate = deriveTokenCountContribution(event("duplicate", { total: raw({ total_tokens: 150 }) }), state(raw({ total_tokens: 150 })));
    const reset = deriveTokenCountContribution(event("reset", { total: raw({ total_tokens: 40 }) }), state(raw({ total_tokens: 150 }), 2));

    expect(initial).toMatchObject({ method: "total-initial", usage: { inputTokens: 100 }, nextState: { segment: 0 } });
    expect(delta).toMatchObject({ method: "total-aggregate-delta", usage: { inputTokens: 50 }, nextState: { segment: 0 } });
    expect(duplicate).toMatchObject({ method: "duplicate-zero", usage: { inputTokens: 0 }, nextState: { segment: 0 } });
    expect(reset).toMatchObject({ method: "total-reset", usage: { inputTokens: 40 }, nextState: { segment: 3 }, diagnostics: { counterReset: true } });
  });

  it("keeps nonzero last usage when total repeats and uses last on reset", () => {
    const repeated = deriveTokenCountContribution(
      event("repeated", { last: raw({ input_tokens: 12 }), total: raw({ total_tokens: 100 }) }),
      state(raw({ total_tokens: 100 })),
    );
    const reset = deriveTokenCountContribution(
      event("reset-last", { last: raw({ input_tokens: 8 }), total: raw({ total_tokens: 20 }) }),
      state(raw({ total_tokens: 100 })),
    );

    expect(repeated).toMatchObject({ method: "last", usage: { inputTokens: 12 }, diagnostics: { repeatedTotalWithNonZeroLast: true } });
    expect(reset).toMatchObject({ method: "last", usage: { inputTokens: 8 }, diagnostics: { counterReset: true } });
  });

  it("does not treat a missing cumulative field as a counter reset", () => {
    const previous = raw({ input_tokens: 100, cached_input_tokens: 20, output_tokens: 10 });
    const current = raw({ total_tokens: 150 });
    const contribution = deriveTokenCountContribution(event("missing-field", { total: current }), state(previous));

    expect(contribution?.diagnostics.counterReset).toBe(false);
    expect(contribution?.method).toBe("total-aggregate-delta");
    expect(totalTokens(contribution!.usage)).toBe(40);
    expect(contribution?.diagnostics.comparisonBasis).toBe("aggregate-cross-schema");
    expect(contribution?.nextState.previousTotalRaw?.fieldPresence.total).toBe(true);
  });

  it("distinguishes explicit zero from a missing cumulative field", () => {
    const previous = raw({ input_tokens: 100, cached_input_tokens: 20, output_tokens: 10 });
    const missing = deriveTokenCountContribution(
      event("missing-cache", { total: raw({ input_tokens: 100, output_tokens: 10 }) }),
      state(previous),
    );
    const explicitZero = deriveTokenCountContribution(
      event("zero-cache", { total: raw({ input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 }) }),
      state(previous),
    );

    expect(missing?.diagnostics.counterReset).toBe(false);
    expect(explicitZero?.diagnostics.counterReset).toBe(false);
    expect(explicitZero?.diagnostics.componentCounterDecrease).toBe(true);
  });

  it("uses aggregate continuity across cumulative schema changes", () => {
    const previous = raw({ input_tokens: 100, output_tokens: 10 });
    const current = raw({ total_tokens: 150 });
    const comparison = compareRawCumulative(current, state(previous));
    const contribution = deriveTokenCountContribution(event("schema-change", { total: current }), state(previous));

    expect(comparison).toMatchObject({
      relation: "increased",
      basis: "aggregate-cross-schema",
      previousAggregate: 110,
      currentAggregate: 150,
      aggregateDelta: 40,
      componentBreakdownExact: false,
    });
    expect(contribution).toMatchObject({
      method: "total-aggregate-delta",
      diagnostics: { comparisonBasis: "aggregate-cross-schema", componentBreakdownExact: false },
    });
    expect(totalTokens(contribution!.usage)).toBe(40);
  });

  it("does not infer duplicate from partial equality", () => {
    const contribution = deriveTokenCountContribution(
      event("incomparable", { total: raw({ input_tokens: 100 }) }),
      state(raw({ input_tokens: 100, output_tokens: 50 })),
    );

    expect(contribution).toMatchObject({
      method: "unresolved",
      usage: { inputTokens: 0, outputTokens: 0 },
      diagnostics: { comparisonBasis: "none", incomparable: true },
    });
  });

  it("does not reset on secondary counter decreases", () => {
    const contribution = deriveTokenCountContribution(
      event("secondary-decrease", { total: raw({ input_tokens: 1_100, cached_input_tokens: 480, output_tokens: 120, reasoning_output_tokens: 40 }) }),
      state(raw({ input_tokens: 1_000, cached_input_tokens: 500, output_tokens: 100, reasoning_output_tokens: 50 })),
    );

    expect(contribution).toMatchObject({
      method: "total-aggregate-delta",
      diagnostics: { counterReset: false, componentCounterDecrease: true, comparisonBasis: "input-output" },
    });
    expect(totalTokens(contribution!.usage)).toBe(120);
  });

  it("gives explicit total priority over abnormal secondary components", () => {
    const contribution = deriveTokenCountContribution(
      event("explicit-total", { total: raw({ total_tokens: 1_100, input_tokens: 950, cached_input_tokens: 400 }) }),
      state(raw({ total_tokens: 1_000, input_tokens: 900, cached_input_tokens: 500 })),
    );

    expect(contribution).toMatchObject({
      method: "total-aggregate-delta",
      diagnostics: { counterReset: false, componentCounterDecrease: true, comparisonBasis: "explicit-total" },
    });
    expect(totalTokens(contribution!.usage)).toBe(100);
  });

  it("handles cross-schema same and reset relations", () => {
    const same = deriveTokenCountContribution(
      event("cross-same", { total: raw({ total_tokens: 120 }) }),
      state(raw({ input_tokens: 100, output_tokens: 20 })),
    );
    const reset = deriveTokenCountContribution(
      event("cross-reset", { total: raw({ total_tokens: 80 }) }),
      state(raw({ input_tokens: 100, output_tokens: 50 }), 2),
    );

    expect(same).toMatchObject({ method: "duplicate-zero", diagnostics: { comparisonBasis: "aggregate-cross-schema", sameAggregateDifferentComponents: true } });
    expect(reset).toMatchObject({ method: "total-reset", nextState: { segment: 3 }, diagnostics: { counterReset: true } });
  });

  it("derives exact five-component deltas only when the component schema is stable", () => {
    const contribution = deriveTokenCountContribution(
      event("exact-components", { total: raw({ input_tokens: 150, cached_input_tokens: 30, output_tokens: 30, reasoning_output_tokens: 8 }) }),
      state(raw({ input_tokens: 100, cached_input_tokens: 20, output_tokens: 20, reasoning_output_tokens: 5 })),
    );

    expect(contribution).toMatchObject({
      method: "total-delta",
      usage: { inputTokens: 40, cachedInputTokens: 10, outputTokens: 7, reasoningOutputTokens: 3 },
      diagnostics: { comparisonBasis: "input-output", componentBreakdownExact: true },
    });
  });

  it("carries the aggregate baseline across a schema shift", () => {
    const first = deriveTokenCountContribution(event("a", { total: raw({ input_tokens: 100, output_tokens: 10 }) }), state());
    const second = deriveTokenCountContribution(event("b", { total: raw({ total_tokens: 150 }) }), first!.nextState);
    const third = deriveTokenCountContribution(event("c", { total: raw({ input_tokens: 180, output_tokens: 20 }) }), second!.nextState);

    expect(second).toMatchObject({ method: "total-aggregate-delta", usage: { inputTokens: 40 } });
    expect(third).toMatchObject({ method: "total-aggregate-delta", usage: { inputTokens: 50 }, diagnostics: { comparisonBasis: "aggregate-cross-schema" } });
  });

  it("keeps last usage as the primary contribution even when cumulative comparison is impossible", () => {
    const contribution = deriveTokenCountContribution(
      event("last-incomparable", { last: raw({ input_tokens: 12 }), total: raw({ input_tokens: 100 }) }),
      state(raw({ input_tokens: 100, output_tokens: 50 })),
    );

    expect(contribution).toMatchObject({
      method: "last",
      usage: { inputTokens: 12 },
      diagnostics: { comparisonBasis: "none", incomparable: true },
    });
  });

  it("hard-deduplicates only repeated raw identities and exposes deterministic identity data", () => {
    const first = event("same", { last: raw({ input_tokens: 10 }) });
    const duplicate = { ...first, eventIndex: 1 };
    const distinct = { ...first, rawIdentity: "different", eventIndex: 2 };
    const otherSession = { ...first, sessionId: "other-session", eventIndex: 3 };
    const result = deduplicateTokenCountEvents([first, duplicate, distinct, otherSession]);

    expect(result.exactDuplicateCount).toBe(1);
    expect(result.events.map((item) => `${item.sessionId}:${item.rawIdentity}`)).toEqual([
      "session:same",
      "session:different",
      "other-session:same",
    ]);
    expect(tokenCountIdentity(first)).toMatchObject({ sessionId: "session", lastFingerprint: expect.any(String) });
  });

  it("never uses wall-clock time for accounting timestamps", () => {
    expect(deterministicAccountingTimestamp({ timestamp: 1_700_000_000_000 })).toBe(1_700_000_000_000);
    expect(deterministicAccountingTimestamp({ timestamp: undefined })).toBeUndefined();
  });
});
