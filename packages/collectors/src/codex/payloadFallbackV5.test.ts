import { describe, expect, it } from "vitest";
import { totalTokens } from "@lw-aiusage/core";
import {
  canonicalTokenCountRefOf,
  payloadUsageCandidateOf,
  resolvePayloadFallbackV5,
  type CanonicalTokenCountRef,
  type PayloadUsageCandidate,
} from "./payloadFallbackV5";
import {
  decodeRawTokenUsage,
  deriveTokenCountContribution,
  type CodexAccountingEvent,
  type RawTokenUsage,
} from "./accountingV5";

const raw = (value: Record<string, unknown>): RawTokenUsage => {
  const result = decodeRawTokenUsage(value);
  if (!result) throw new Error("expected usage");
  return result;
};

const event = (
  rawIdentity: string,
  options: {
    sessionId?: string;
    sourcePath?: string;
    eventIndex?: number;
    timestamp?: number;
    model?: string;
    responseId?: string;
    turnId?: string;
    tokenCount?: CodexAccountingEvent["tokenCount"];
    payloadUsage?: RawTokenUsage;
  } = {},
): CodexAccountingEvent => ({
  sourcePath: options.sourcePath ?? "/fixture/session.jsonl",
  eventIndex: options.eventIndex ?? 0,
  sessionId: options.sessionId ?? "session",
  timestamp: options.timestamp,
  model: options.model,
  responseId: options.responseId,
  turnId: options.turnId,
  tokenCount: options.tokenCount,
  payloadUsage: options.payloadUsage,
  rawIdentity,
});

const tokenRef = (
  rawIdentity: string,
  usage: Record<string, unknown>,
  options: Parameters<typeof event>[1] = {},
): CanonicalTokenCountRef => {
  const tokenEvent = event(rawIdentity, { ...options, tokenCount: { last: raw(usage) } });
  const contribution = deriveTokenCountContribution(tokenEvent, { segment: 0 });
  if (!contribution) throw new Error("expected token contribution");
  const ref = canonicalTokenCountRefOf(tokenEvent, contribution);
  if (!ref) throw new Error("expected token reference");
  return ref;
};

const payload = (
  rawIdentity: string,
  usage: Record<string, unknown>,
  options: Parameters<typeof event>[1] = {},
): PayloadUsageCandidate => {
  const candidate = payloadUsageCandidateOf(event(rawIdentity, { ...options, payloadUsage: raw(usage) }));
  if (!candidate) throw new Error("expected payload candidate");
  return candidate;
};

describe("Codex v5 payload fallback", () => {
  it("suppresses an exact same-raw-event component duplicate", () => {
    const token = tokenRef("raw-1", { input_tokens: 100, output_tokens: 20 });
    const duplicate = payload("raw-1", { input_tokens: 100, output_tokens: 20 });

    const result = resolvePayloadFallbackV5([token], [duplicate]);

    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0]?.evidence).toBe("same-raw-event-components");
    expect(result.fallbacks).toHaveLength(0);
    expect(result.diagnostics.confirmedSuppressedTokens).toBe(120);
    expect(result.payloadEventInvariant).toBe(true);
    expect(result.payloadTokenInvariant).toBe(true);
  });

  it("suppresses an exact same-raw-event aggregate duplicate", () => {
    const token = tokenRef("raw-aggregate", { total_tokens: 120 });
    const duplicate = payload("raw-aggregate", { input_tokens: 100, output_tokens: 20 });

    const result = resolvePayloadFallbackV5([token], [duplicate]);

    expect(result.suppressed[0]?.evidence).toBe("same-raw-event-aggregate");
    expect(result.fallbacks).toHaveLength(0);
  });

  it("suppresses a unique exact component match by response id", () => {
    const token = tokenRef("token", { input_tokens: 100, output_tokens: 20 }, { responseId: "response-1" });
    const duplicate = payload("payload", { input_tokens: 100, output_tokens: 20 }, { responseId: "response-1" });

    const result = resolvePayloadFallbackV5([token], [duplicate]);

    expect(result.suppressed[0]?.evidence).toBe("same-response-id-components");
    expect(result.diagnostics.sameResponseSuppressedEvents).toBe(1);
  });

  it("does not match across sessions even when response ids and usage are equal", () => {
    const token = tokenRef("token", { input_tokens: 100, output_tokens: 20 }, { sessionId: "session-a", responseId: "response-1" });
    const candidate = payload("payload", { input_tokens: 100, output_tokens: 20 }, { sessionId: "session-b", responseId: "response-1" });

    const result = resolvePayloadFallbackV5([token], [candidate]);

    expect(result.fallbacks).toHaveLength(1);
    expect(result.fallbacks[0]?.reason).toBe("fallback-unmatched");
    expect(result.resolutions[0]?.reason).toBe("no-token-candidate");
  });

  it("does not suppress aggregate-only response matches", () => {
    const token = tokenRef("token", { total_tokens: 120 }, { responseId: "response-1" });
    const candidate = payload("payload", { input_tokens: 100, output_tokens: 20 }, { responseId: "response-1" });

    const result = resolvePayloadFallbackV5([token], [candidate]);

    expect(result.suppressed).toHaveLength(0);
    expect(result.fallbacks[0]?.reason).toBe("fallback-conflict");
    expect(result.resolutions[0]?.reason).toBe("same-total-different-components");
  });

  it("reports same-total different-components as a conflict", () => {
    const token = tokenRef("token", { input_tokens: 100, output_tokens: 20 }, { responseId: "response-1" });
    const candidate = payload("payload", { input_tokens: 90, output_tokens: 30 }, { responseId: "response-1" });

    const result = resolvePayloadFallbackV5([token], [candidate]);

    expect(result.fallbacks[0]?.reason).toBe("fallback-conflict");
    expect(result.resolutions[0]?.reason).toBe("same-total-different-components");
    expect(result.diagnostics.sameResponseSameTotalDifferentComponentsEvents).toBe(1);
  });

  it("reports different usage for the same response as a conflict", () => {
    const token = tokenRef("token", { input_tokens: 100, output_tokens: 20 }, { responseId: "response-1" });
    const candidate = payload("payload", { input_tokens: 90, output_tokens: 25 }, { responseId: "response-1" });

    const result = resolvePayloadFallbackV5([token], [candidate]);

    expect(result.fallbacks[0]?.reason).toBe("fallback-conflict");
    expect(result.resolutions[0]?.reason).toBe("different-components");
    expect(result.diagnostics.sameResponseDifferentUsageEvents).toBe(1);
  });

  it("requires mutual uniqueness when multiple candidates share a response id", () => {
    const tokenA = tokenRef("token-a", { input_tokens: 100, output_tokens: 20 }, { responseId: "response-1" });
    const tokenB = tokenRef("token-b", { input_tokens: 100, output_tokens: 20 }, { responseId: "response-1", eventIndex: 1 });
    const candidate = payload("payload", { input_tokens: 100, output_tokens: 20 }, { responseId: "response-1" });

    const result = resolvePayloadFallbackV5([tokenA, tokenB], [candidate]);

    expect(result.suppressed).toHaveLength(0);
    expect(result.fallbacks[0]?.reason).toBe("fallback-ambiguous");
    expect(result.resolutions[0]?.reason).toBe("multiple-candidates");
  });

  it("requires mutual uniqueness when multiple payloads share a response id", () => {
    const token = tokenRef("token", { input_tokens: 100, output_tokens: 20 }, { responseId: "response-1" });
    const candidateA = payload("payload-a", { input_tokens: 100, output_tokens: 20 }, { responseId: "response-1" });
    const candidateB = payload("payload-b", { input_tokens: 100, output_tokens: 20 }, { responseId: "response-1", eventIndex: 1 });

    const result = resolvePayloadFallbackV5([token], [candidateA, candidateB]);

    expect(result.suppressed).toHaveLength(0);
    expect(result.fallbacks).toHaveLength(2);
    expect(result.diagnostics.ambiguousEvents).toBe(2);
  });

  it("deduplicates exact payload raw events before matching", () => {
    const token = tokenRef("raw-1", { input_tokens: 100, output_tokens: 20 });
    const first = payload("raw-1", { input_tokens: 100, output_tokens: 20 });
    const duplicate = payload("raw-1", { input_tokens: 100, output_tokens: 20 });

    const result = resolvePayloadFallbackV5([token], [first, duplicate]);

    expect(result.diagnostics.exactRawDuplicateEvents).toBe(1);
    expect(result.diagnostics.exactRawDuplicateTokens).toBe(120);
    expect(result.suppressed).toHaveLength(1);
    expect(result.resolutions).toHaveLength(1);
  });

  it("does not reuse a token consumed by the stronger raw-event pass", () => {
    const token = tokenRef("raw-1", { input_tokens: 100, output_tokens: 20 }, { responseId: "response-1" });
    const rawDuplicate = payload("raw-1", { input_tokens: 100, output_tokens: 20 }, { responseId: "response-1" });
    const responseDuplicate = payload("payload-2", { input_tokens: 100, output_tokens: 20 }, { responseId: "response-1" });

    const result = resolvePayloadFallbackV5([token], [rawDuplicate, responseDuplicate]);

    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0]?.payload.event.rawIdentity).toBe("raw-1");
    expect(result.fallbacks).toHaveLength(1);
    expect(result.fallbacks[0]?.event.rawIdentity).toBe("payload-2");
    expect(result.fallbacks[0]?.reason).toBe("fallback-unmatched");
  });

  it("does not let turn id or nearby timestamps suppress a payload", () => {
    const token = tokenRef("token", { input_tokens: 100, output_tokens: 20 }, { turnId: "turn-1", timestamp: 1000 });
    const candidate = payload("payload", { input_tokens: 100, output_tokens: 20 }, { turnId: "turn-1", timestamp: 1001 });

    const result = resolvePayloadFallbackV5([token], [candidate]);

    expect(result.suppressed).toHaveLength(0);
    expect(result.fallbacks[0]?.reason).toBe("fallback-unmatched");
    expect(result.resolutions[0]?.reason).toBe("no-response-id");
  });

  it("keeps model conflicts conservative", () => {
    const token = tokenRef("token", { input_tokens: 100, output_tokens: 20 }, { responseId: "response-1", model: "gpt-a" });
    const candidate = payload("payload", { input_tokens: 100, output_tokens: 20 }, { responseId: "response-1", model: "gpt-b" });

    const result = resolvePayloadFallbackV5([token], [candidate]);

    expect(result.suppressed).toHaveLength(0);
    expect(result.fallbacks[0]?.reason).toBe("fallback-conflict");
    expect(result.resolutions[0]?.reason).toBe("model-conflict");
    expect(result.diagnostics.modelConflictEvents).toBe(1);
  });

  it("preserves inconsistent payload snapshots as aggregate-only fallback data", () => {
    const candidate = payload("payload", { input_tokens: 100, output_tokens: 20, total_tokens: 100 });

    expect(candidate.precision).toBe("aggregate-only");
    expect(candidate.usage.inputTokens).toBe(100);
    expect(totalTokens(candidate.usage)).toBe(100);
    expect(candidate.componentConsistencyMismatch).toBe(true);
  });

  it("ignores zero payloads without creating fallback usage", () => {
    const result = resolvePayloadFallbackV5([], [payload("zero", { input_tokens: 0, output_tokens: 0 })]);

    expect(result.fallbacks).toHaveLength(0);
    expect(result.diagnostics.zeroEvents).toBe(1);
    expect(result.resolutions[0]?.disposition).toBe("ignore-zero");
    expect(result.payloadEventInvariant).toBe(true);
    expect(result.payloadTokenInvariant).toBe(true);
  });

  it("allows a payload fallback when no positive canonical token ref exists", () => {
    const candidate = payload("payload", { input_tokens: 100 }, { responseId: "response-1" });

    const result = resolvePayloadFallbackV5([], [candidate]);

    expect(result.suppressed).toHaveLength(0);
    expect(result.fallbacks).toHaveLength(1);
    expect(result.fallbacks[0]?.reason).toBe("fallback-unmatched");
  });

  it("matches independently of input order and returns deterministic resolutions", () => {
    const tokenA = tokenRef("token-a", { input_tokens: 10, output_tokens: 1 }, { responseId: "response-a", timestamp: 200 });
    const tokenB = tokenRef("token-b", { input_tokens: 20, output_tokens: 2 }, { responseId: "response-b", timestamp: 100 });
    const payloadA = payload("payload-a", { input_tokens: 10, output_tokens: 1 }, { responseId: "response-a", timestamp: 200 });
    const payloadB = payload("payload-b", { input_tokens: 20, output_tokens: 2 }, { responseId: "response-b", timestamp: 100 });

    const result = resolvePayloadFallbackV5([tokenA, tokenB], [payloadA, payloadB]);
    const reversed = resolvePayloadFallbackV5([tokenB, tokenA], [payloadB, payloadA]);

    expect(result.suppressed.map((item) => item.payload.event.rawIdentity)).toEqual(["payload-b", "payload-a"]);
    expect(reversed.suppressed.map((item) => item.payload.event.rawIdentity)).toEqual(["payload-b", "payload-a"]);
    expect(result.diagnostics).toEqual(reversed.diagnostics);
  });
});
