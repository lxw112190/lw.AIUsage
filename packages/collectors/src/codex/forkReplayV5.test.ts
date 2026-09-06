import { describe, expect, it } from "vitest";
import { totalTokens, type TokenUsage } from "@lw-aiusage/core";
import {
  buildForkSessionGraphV5,
  canonicalUsageFromPayloadFallback,
  canonicalUsageFromTokenCount,
  findForkBaselineCheckpoint,
  resolveForkBaselinesV5,
  resolveForkReplayV5,
  sameForkReplayContribution,
  type CanonicalUsageContributionV5,
  type ForkCanonicalSessionV5,
  type ForkSessionSourceV5,
} from "./forkReplayV5";
import { decodeRawTokenUsage, deriveTokenCountContribution, type CodexAccountingEvent, type RawTokenUsage } from "./accountingV5";
import { payloadUsageCandidateOf, type PayloadFallbackContribution } from "./payloadFallbackV5";

const raw = (value: Record<string, unknown>): RawTokenUsage => {
  const result = decodeRawTokenUsage(value);
  if (!result) throw new Error("expected usage");
  return result;
};

const event = (
  rawIdentity: string,
  options: {
    timestamp?: number;
    sessionId?: string;
    eventIndex?: number;
    responseId?: string;
    turnId?: string;
    model?: string;
    tokenCount?: CodexAccountingEvent["tokenCount"];
    payloadUsage?: RawTokenUsage;
  } = {},
): CodexAccountingEvent => ({
  sourcePath: options.sessionId ? `/fixture/${options.sessionId}.jsonl` : "/fixture/session.jsonl",
  eventIndex: options.eventIndex ?? 0,
  sessionId: options.sessionId,
  timestamp: options.timestamp,
  responseId: options.responseId,
  turnId: options.turnId,
  model: options.model,
  tokenCount: options.tokenCount,
  payloadUsage: options.payloadUsage,
  rawIdentity,
});

const totalEvent = (
  rawIdentity: string,
  total: Record<string, unknown>,
  timestamp: number,
  options: Parameters<typeof event>[1] = {},
): CodexAccountingEvent => event(rawIdentity, { ...options, timestamp, tokenCount: { total: raw(total) } });

const tokenContribution = (
  rawIdentity: string,
  usage: Record<string, unknown>,
  options: Parameters<typeof event>[1] = {},
): CanonicalUsageContributionV5 => {
  const tokenEvent = event(rawIdentity, { ...options, tokenCount: { last: raw(usage) } });
  const contribution = deriveTokenCountContribution(tokenEvent, { segment: 0 });
  if (!contribution) throw new Error("expected contribution");
  return canonicalUsageFromTokenCount({
    event: tokenEvent,
    usage: contribution.usage,
    aggregateTotal: totalTokens(contribution.usage),
    method: contribution.method,
    precision: contribution.method === "last" ? "components-exact" : "partial",
  });
};

const canonical = (
  rawIdentity: string,
  tokens: number,
  timestamp: number,
  options: Parameters<typeof event>[1] = {},
): CanonicalUsageContributionV5 => tokenContribution(rawIdentity, { input_tokens: tokens }, { ...options, timestamp });

const session = (
  sessionId: string,
  options: {
    parentSessionId?: string;
    forkTimestamp?: number;
    events?: readonly CodexAccountingEvent[];
  } = {},
): ForkSessionSourceV5 => ({ sessionId, ...options, events: options.events ?? [] });

const canonicalSession = (
  sessionId: string,
  options: {
    parentSessionId?: string;
    forkTimestamp?: number;
    contributions: readonly CanonicalUsageContributionV5[];
  },
): ForkCanonicalSessionV5 => ({ sessionId, ...options });

describe("Codex v5 fork graph and baseline", () => {
  it("selects the last parent checkpoint strictly before fork", () => {
    const parent = session("parent", {
      events: [
        totalEvent("p100", { total_tokens: 100 }, 100),
        totalEvent("p150", { total_tokens: 150 }, 150),
        totalEvent("p220", { total_tokens: 220 }, 220),
      ],
    });

    const checkpoint = findForkBaselineCheckpoint(parent, 200);

    expect(checkpoint?.rawTotal.total).toBe(150);
    expect(checkpoint?.timestamp).toBe(150);
  });

  it("resolves inherited cumulative baseline without using the parent terminal total", () => {
    const parent = session("parent", {
      events: [
        totalEvent("p100", { total_tokens: 100 }, 100),
        totalEvent("p150", { total_tokens: 150 }, 150),
        totalEvent("p220", { total_tokens: 220 }, 220),
      ],
    });
    const child = session("child", {
      parentSessionId: "parent",
      forkTimestamp: 200,
      events: [totalEvent("c180", { total_tokens: 180 }, 210)],
    });

    const result = resolveForkBaselinesV5([child, parent]);
    const resolution = result.resolutions.get("child");

    expect(resolution).toMatchObject({
      status: "resolved",
      checkpoint: { aggregateTotal: 150 },
      initialState: { previousTotalRaw: { total: 150 } },
      previewMethod: "total-aggregate-delta",
      previewContributionAggregate: 30,
    });
    expect(result.diagnostics.resolvedBaselineSessions).toBe(1);
  });

  it("recognizes equal inherited snapshots and preserves last-first semantics", () => {
    const parent = session("parent", { events: [totalEvent("p150", { total_tokens: 150 }, 150)] });
    const equalChild = session("equal", {
      parentSessionId: "parent",
      forkTimestamp: 200,
      events: [totalEvent("c150", { total_tokens: 150 }, 210)],
    });
    const lastChild = session("last", {
      parentSessionId: "parent",
      forkTimestamp: 200,
      events: [event("c-last", { timestamp: 210, tokenCount: { last: raw({ input_tokens: 30 }), total: raw({ total_tokens: 180 }) } })],
    });

    const result = resolveForkBaselinesV5([equalChild, lastChild, parent]);

    expect(result.resolutions.get("equal")).toMatchObject({ status: "resolved", previewMethod: "duplicate-zero", previewContributionAggregate: 0 });
    expect(result.resolutions.get("last")).toMatchObject({ status: "resolved", previewMethod: "last", previewContributionAggregate: 30 });
  });

  it("does not seed a child counter after reset or when schemas are incomparable", () => {
    const parent = session("parent", { events: [totalEvent("p150", { total_tokens: 150 }, 150)] });
    const reset = session("reset", {
      parentSessionId: "parent",
      forkTimestamp: 200,
      events: [totalEvent("c20", { total_tokens: 20 }, 210)],
    });
    const incomparable = session("incomparable", {
      parentSessionId: "parent",
      forkTimestamp: 200,
      events: [totalEvent("c-partial", { reasoning_output_tokens: 20 }, 210)],
    });

    const result = resolveForkBaselinesV5([incomparable, reset, parent]);

    expect(result.resolutions.get("reset")).toMatchObject({ status: "child-counter-reset" });
    expect(result.resolutions.get("reset")?.initialState).toBeUndefined();
    expect(result.resolutions.get("incomparable")).toMatchObject({ status: "incomparable" });
  });

  it("keeps missing parent, timestamp, checkpoint, and explicit replay conservative", () => {
    const missingParent = session("missing", { parentSessionId: "unknown", forkTimestamp: 200 });
    const missingTimestamp = session("no-time", { parentSessionId: "parent", events: [] });
    const noCheckpoint = session("no-checkpoint", { parentSessionId: "parent", forkTimestamp: 200, events: [totalEvent("c10", { total_tokens: 10 }, 210)] });
    const explicit = session("explicit", {
      parentSessionId: "parent",
      forkTimestamp: 200,
      events: [totalEvent("old", { total_tokens: 10 }, 100), totalEvent("new", { total_tokens: 20 }, 210)],
    });

    const result = resolveForkBaselinesV5([explicit, noCheckpoint, missingParent, missingTimestamp, session("parent")]);

    expect(result.resolutions.get("missing")?.status).toBe("missing-parent");
    expect(result.resolutions.get("no-time")?.status).toBe("missing-fork-timestamp");
    expect(result.resolutions.get("no-checkpoint")?.status).toBe("missing-parent-checkpoint");
    expect(result.resolutions.get("explicit")?.status).toBe("explicit-replay");
    expect(result.resolutions.get("explicit")?.initialState).toBeUndefined();
  });

  it("builds deterministic multilevel graphs and marks cycles and conflicting parents", () => {
    const a = session("a");
    const b = session("b", { parentSessionId: "a" });
    const c = session("c", { parentSessionId: "b" });
    const cycleA = session("cycle-a", { parentSessionId: "cycle-b" });
    const cycleB = session("cycle-b", { parentSessionId: "cycle-a" });
    const conflictA = session("conflict", { parentSessionId: "a" });
    const conflictB = session("conflict", { parentSessionId: "b" });

    const first = buildForkSessionGraphV5([c, cycleB, conflictB, a, cycleA, conflictA, b]);
    const second = buildForkSessionGraphV5([a, b, c, cycleA, cycleB, conflictA, conflictB]);

    expect(first.topologicalOrder).toEqual(second.topologicalOrder);
    expect(first.cycles).toEqual([["cycle-a", "cycle-b"]]);
    expect(first.conflictingParents).toEqual(["conflict"]);
    expect(first.nodes.get("a")?.children).toEqual(["b"]);
  });
});

describe("Codex v5 fork replay matching", () => {
  it("suppresses a complete pre-fork canonical prefix and keeps post-fork events", () => {
    const parentContributions = [
      canonical("a", 10, 100, { responseId: "r-a" }),
      canonical("b", 20, 200, { responseId: "r-b" }),
      canonical("c", 30, 250, { responseId: "r-c" }),
    ];
    const childContributions = [
      canonical("a-copy", 10, 100, { responseId: "r-a" }),
      canonical("b-copy", 20, 200, { responseId: "r-b" }),
      canonical("c-copy", 30, 250, { responseId: "r-c" }),
      canonical("x", 40, 350, { responseId: "r-x" }),
    ];

    const result = resolveForkReplayV5([
      canonicalSession("child", { parentSessionId: "parent", forkTimestamp: 300, contributions: childContributions }),
      canonicalSession("parent", { contributions: parentContributions }),
    ]);
    const child = result.sessions.find((item) => item.sessionId === "child")!;

    expect(child.status).toBe("resolved");
    expect(child.replayPrefixCount).toBe(3);
    expect(child.replayPrefixTokens).toBe(60);
    expect(child.kept.map((item) => item.event.rawIdentity)).toEqual(["x"]);
    expect(result.contributionInvariant).toBe(true);
    expect(result.tokenInvariant).toBe(true);
  });

  it("stops at the first prefix mismatch instead of searching later events", () => {
    const parent = [
      canonical("a", 10, 100, { responseId: "r-a" }),
      canonical("b", 20, 200, { responseId: "r-b" }),
      canonical("c", 30, 250, { responseId: "r-c" }),
    ];
    const child = [
      canonical("a-copy", 10, 100, { responseId: "r-a" }),
      canonical("x", 20, 200, { responseId: "r-x" }),
      canonical("c-copy", 30, 250, { responseId: "r-c" }),
    ];

    const result = resolveForkReplayV5([
      canonicalSession("parent", { contributions: parent }),
      canonicalSession("child", { parentSessionId: "parent", forkTimestamp: 300, contributions: child }),
    ]);
    const childResult = result.sessions.find((item) => item.sessionId === "child")!;

    expect(childResult.replayPrefixCount).toBe(1);
    expect(childResult.kept.map((item) => item.event.rawIdentity)).toEqual(["x", "c-copy"]);
    expect(result.diagnostics.replayPrefixMismatchSessions).toBe(1);
  });

  it("matches across token-count and payload-fallback provenance", () => {
    const parent = canonical("parent", 10, 100, { responseId: "response-1" });
    const payloadEvent = event("child-payload", { timestamp: 100, responseId: "response-1", payloadUsage: raw({ input_tokens: 10, output_tokens: 0 }) });
    const candidate = payloadUsageCandidateOf(payloadEvent)!;
    const fallback: PayloadFallbackContribution = {
      event: candidate.event,
      usage: candidate.usage,
      aggregateTotal: candidate.aggregateTotal,
      sourceKind: "payload-fallback",
      precision: candidate.precision,
      reason: "fallback-unmatched",
    };
    const child = canonicalUsageFromPayloadFallback(fallback);

    expect(parent.sourceKind).toBe("token-count");
    expect(child.sourceKind).toBe("payload-fallback");
    expect(sameForkReplayContribution(parent, child)).toBe(true);
  });

  it("blocks partial, missing-identity, boundary, and post-fork replay candidates", () => {
    const exact = canonical("exact", 10, 100, { responseId: "r" });
    const partial: CanonicalUsageContributionV5 = { ...exact, precision: "partial" };
    const noIdentity = canonical("no-id", 10, 100);
    const boundary = canonical("boundary", 10, 300, { responseId: "r" });
    const postFork = canonical("post", 10, 301, { responseId: "r" });

    expect(sameForkReplayContribution(exact, partial)).toBe(false);
    expect(sameForkReplayContribution(exact, noIdentity)).toBe(false);
    expect(sameForkReplayContribution(exact, boundary)).toBe(false);
    expect(sameForkReplayContribution(exact, postFork)).toBe(false);

    const result = resolveForkReplayV5([
      canonicalSession("parent", { contributions: [exact] }),
      canonicalSession("child", { parentSessionId: "parent", forkTimestamp: 300, contributions: [partial, boundary, postFork] }),
    ]);
    const child = result.sessions.find((item) => item.sessionId === "child")!;

    expect(child.suppressed).toHaveLength(0);
    expect(child.kept).toHaveLength(3);
    expect(result.diagnostics.partialReplayBlockedEvents).toBe(1);
  });

  it("keeps unresolved graph and fork metadata untouched", () => {
    const child = canonicalSession("child", { parentSessionId: "missing", forkTimestamp: 100, contributions: [canonical("c", 10, 50, { responseId: "r" })] });
    const result = resolveForkReplayV5([child]);

    expect(result.sessions[0]).toMatchObject({ status: "missing-parent", replayPrefixCount: 0, replayPrefixTokens: 0 });
    expect(result.sessions[0]?.kept).toHaveLength(1);
    expect(result.contributionInvariant).toBe(true);
    expect(result.tokenInvariant).toBe(true);
  });

  it("is archive-path independent and input-order independent", () => {
    const parent = canonicalSession("parent", { contributions: [canonical("p", 10, 100, { responseId: "r" })] });
    const child = canonicalSession("child", { parentSessionId: "parent", forkTimestamp: 200, contributions: [canonical("c", 10, 100, { responseId: "r" })] });
    const movedParent = { ...parent, contributions: parent.contributions.map((item) => ({ ...item, event: { ...item.event, sourcePath: "/archived/parent.jsonl" } })) };
    const movedChild = { ...child, contributions: child.contributions.map((item) => ({ ...item, event: { ...item.event, sourcePath: "/archived/child.jsonl" } })) };

    const result = resolveForkReplayV5([child, parent]);
    const moved = resolveForkReplayV5([movedParent, movedChild]);

    const semanticSessions = (value: typeof result.sessions) => value.map((item) => ({
      sessionId: item.sessionId,
      parentSessionId: item.parentSessionId,
      status: item.status,
      replayPrefixCount: item.replayPrefixCount,
      replayPrefixTokens: item.replayPrefixTokens,
      kept: item.kept.map((contribution) => contribution.event.rawIdentity),
      suppressed: item.suppressed.map((suppression) => ({
        child: suppression.child.event.rawIdentity,
        parent: suppression.parent.event.rawIdentity,
      })),
    }));

    expect(semanticSessions(result.sessions)).toEqual(semanticSessions(moved.sessions));
    expect(result.diagnostics).toEqual(moved.diagnostics);
  });
});
