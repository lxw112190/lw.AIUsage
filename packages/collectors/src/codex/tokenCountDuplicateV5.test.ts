import { describe, expect, it } from "vitest";
import { analyzeTokenCountDuplicatesV5, resolveTokenCountDuplicatesV5 } from "./tokenCountDuplicateV5";
import type { CodexAccountingEvent, RawTokenUsage } from "./accountingV5";

const raw = (values: Partial<Omit<RawTokenUsage, "fieldPresence">> = {}, present: Partial<RawTokenUsage["fieldPresence"]> = {}): RawTokenUsage => ({
  input: values.input ?? 0,
  cachedInput: values.cachedInput ?? 0,
  cacheCreationInput: values.cacheCreationInput ?? 0,
  output: values.output ?? 0,
  reasoningOutput: values.reasoningOutput ?? 0,
  total: values.total ?? 0,
  fieldPresence: {
    input: present.input ?? values.input !== undefined,
    cachedInput: present.cachedInput ?? values.cachedInput !== undefined,
    cacheCreationInput: present.cacheCreationInput ?? values.cacheCreationInput !== undefined,
    output: present.output ?? values.output !== undefined,
    reasoningOutput: present.reasoningOutput ?? values.reasoningOutput !== undefined,
    total: present.total ?? values.total !== undefined,
  },
});

const event = (index: number, options: {
  sessionId?: string;
  timestamp?: number;
  responseId?: string;
  turnId?: string;
  model?: string;
  rawFingerprint?: string;
  semanticFingerprint?: string;
  last?: RawTokenUsage;
  total?: RawTokenUsage;
} = {}): CodexAccountingEvent => ({
  sourcePath: `/sessions/${options.sessionId ?? "s"}.jsonl`,
  eventIndex: index,
  sessionId: options.sessionId ?? "s",
  timestamp: options.timestamp ?? 100,
  model: options.model ?? "gpt-5",
  responseId: options.responseId,
  turnId: options.turnId,
  semanticType: "token_count",
  tokenCount: { last: options.last, total: options.total },
  rawIdentity: `e${index}:h${options.rawFingerprint ?? `raw-${index}`}`,
  rawContentFingerprint: options.rawFingerprint ?? `raw-${index}`,
  semanticContentFingerprint: options.semanticFingerprint,
});

const cumulative = (total = 100): RawTokenUsage => raw({ input: total, output: 0, total });

describe("Codex v5 TokenCount duplicate evidence", () => {
  it("confirms identical raw content without suppressing it", () => {
    const result = analyzeTokenCountDuplicatesV5([
      event(1, { rawFingerprint: "same", total: cumulative() }),
      event(2, { rawFingerprint: "same", total: cumulative() }),
    ]);

    expect(result).toMatchObject({ candidatePairs: 1, confirmedPairs: 1, unresolvedCandidateTokens: 0 });
    expect(result.examples[0]).toMatchObject({ kind: "exact-raw-content", confidence: "confirmed", suppressible: false });
  });

  it("suppresses only the later confirmed occurrence before accounting", () => {
    const result = resolveTokenCountDuplicatesV5([
      event(1, { rawFingerprint: "same", total: cumulative() }),
      event(2, { rawFingerprint: "same", total: cumulative() }),
    ]);

    expect(result.events.map((item) => item.eventIndex)).toEqual([1]);
    expect(result.suppressed).toHaveLength(1);
    expect(result.diagnostics).toMatchObject({ exactRawContentDuplicateEvents: 1, suppressedDuplicateEvents: 1, suppressedDuplicateTokens: 100, duplicateConflicts: 0 });
    expect(result.safe).toBe(true);
  });

  it("fails closed when a shared raw fingerprint carries different usage", () => {
    const result = resolveTokenCountDuplicatesV5([
      event(1, { rawFingerprint: "same", total: cumulative(100) }),
      event(2, { rawFingerprint: "same", total: cumulative(101) }),
    ]);

    expect(result.events).toHaveLength(2);
    expect(result.suppressed).toHaveLength(0);
    expect(result.diagnostics.duplicateConflicts).toBe(1);
    expect(result.safe).toBe(false);
  });

  it("classifies an exact cumulative snapshot with a shared response as strong", () => {
    const result = analyzeTokenCountDuplicatesV5([
      event(1, { rawFingerprint: "a", total: cumulative(), responseId: "r" }),
      event(2, { rawFingerprint: "b", total: cumulative(), responseId: "r" }),
    ]);

    expect(result.examples[0]).toMatchObject({ kind: "same-cumulative-snapshot", confidence: "strong", sameCumulativeSnapshot: true });
  });

  it("classifies a snapshot without positive identity as probable", () => {
    const result = analyzeTokenCountDuplicatesV5([
      event(1, { rawFingerprint: "a", total: cumulative() }),
      event(2, { rawFingerprint: "b", total: cumulative() }),
    ]);

    expect(result).toMatchObject({
      probablePairs: 1,
      strongPairs: 0,
      unresolvedPrimaryTokens: 100,
      unresolvedCandidateTokens: 100,
    });
    expect(result.examples[0]?.confidence).toBe("probable");
  });

  it("fails closed on response, turn, and model conflicts", () => {
    const responseConflict = analyzeTokenCountDuplicatesV5([
      event(1, { rawFingerprint: "a", total: cumulative(), responseId: "r1" }),
      event(2, { rawFingerprint: "b", total: cumulative(), responseId: "r2" }),
    ]);
    const turnConflict = analyzeTokenCountDuplicatesV5([
      event(1, { rawFingerprint: "a", total: cumulative(), turnId: "t1" }),
      event(2, { rawFingerprint: "b", total: cumulative(), turnId: "t2" }),
    ]);
    const modelConflict = analyzeTokenCountDuplicatesV5([
      event(1, { rawFingerprint: "a", total: cumulative(), model: "gpt-5" }),
      event(2, { rawFingerprint: "b", total: cumulative(), model: "gpt-4.1" }),
    ]);

    expect(responseConflict.examples[0]).toMatchObject({ kind: "explicit-conflict", confidence: "conflict", suppressible: false });
    expect(turnConflict.examples[0]?.confidence).toBe("conflict");
    expect(modelConflict.examples[0]?.confidence).toBe("conflict");
  });

  it("recognizes a representation pair while preserving the raw snapshot rule", () => {
    const result = analyzeTokenCountDuplicatesV5([
      event(1, { rawFingerprint: "a", total: cumulative(), last: raw({ input: 100, output: 0 }), semanticFingerprint: "a" }),
      event(2, { rawFingerprint: "b", total: cumulative(), last: raw({ total: 100 }), semanticFingerprint: "b" }),
    ]);

    expect(result.examples[0]).toMatchObject({ kind: "representation-pair", confidence: "probable" });
  });

  it("does not pair different sessions, timestamps, or field-presence shapes", () => {
    expect(analyzeTokenCountDuplicatesV5([
      event(1, { sessionId: "a", total: cumulative() }),
      event(2, { sessionId: "b", total: cumulative() }),
    ]).candidatePairs).toBe(0);
    expect(analyzeTokenCountDuplicatesV5([
      event(1, { timestamp: 100, rawFingerprint: "a", total: cumulative() }),
      event(2, { timestamp: 101, rawFingerprint: "b", total: cumulative() }),
    ]).candidatePairs).toBe(0);
    expect(analyzeTokenCountDuplicatesV5([
      event(1, { rawFingerprint: "a", total: raw({ input: 100, total: 100 }) }),
      event(2, { rawFingerprint: "b", total: raw({ input: 100, total: 100 }, { output: true }) }),
    ]).candidatePairs).toBe(0);
  });

  it("uses the previous cumulative snapshot to classify a primary-only transition", () => {
    const events = [
      event(0, { total: cumulative(100) }),
      event(1, { rawFingerprint: "primary", total: cumulative(180), last: raw({ input: 80, output: 0 }) }),
      event(2, { rawFingerprint: "candidate", total: cumulative(180), last: raw({ input: 70, output: 0 }) }),
    ];
    const result = analyzeTokenCountDuplicatesV5(events);

    expect(result.examples[0]).toMatchObject({
      confidence: "strong",
      transitionClassification: "primary-only",
      primaryMatchesTransition: true,
      candidateMatchesTransition: false,
      transitionTokens: 80,
    });
    expect(result.transition.primaryOnly).toBe(1);
    const resolved = resolveTokenCountDuplicatesV5(events);
    expect(resolved.events.map((item) => item.eventIndex)).toEqual([0, 1]);
    expect(resolved.suppressed[0]).toMatchObject({
      representativeRawIdentity: "e1:hprimary",
      suppressedRawIdentity: "e2:hcandidate",
      kind: "semantic-snapshot",
      confidence: "strong",
      suppressedTokens: 70,
    });
    expect(resolved.summary).toMatchObject({ resolvedStrongPairs: 1, unresolvedPairs: 0, unresolvedCandidateTokens: 0 });
  });

  it("identifies candidate-only and both-transition evidence", () => {
    const candidateOnly = analyzeTokenCountDuplicatesV5([
      event(0, { total: cumulative(100) }),
      event(1, { rawFingerprint: "primary", total: cumulative(180), last: raw({ input: 70, output: 0 }) }),
      event(2, { rawFingerprint: "candidate", total: cumulative(180), last: raw({ input: 80, output: 0 }) }),
    ]);
    expect(candidateOnly.examples[0]).toMatchObject({ confidence: "strong", transitionClassification: "candidate-only" });
    const candidateOnlyResolution = resolveTokenCountDuplicatesV5([
      event(0, { total: cumulative(100) }),
      event(1, { rawFingerprint: "primary", total: cumulative(180), last: raw({ input: 70, output: 0 }) }),
      event(2, { rawFingerprint: "candidate", total: cumulative(180), last: raw({ input: 80, output: 0 }) }),
    ]);
    expect(candidateOnlyResolution.events.map((item) => item.eventIndex)).toEqual([0, 2]);
    expect(candidateOnlyResolution.suppressed[0]).toMatchObject({ suppressedRawIdentity: "e1:hprimary", suppressedTokens: 70 });

    const both = analyzeTokenCountDuplicatesV5([
      event(0, { total: cumulative(100) }),
      event(1, { rawFingerprint: "primary", total: cumulative(180), last: raw({ input: 80, output: 0 }) }),
      event(2, { rawFingerprint: "candidate", total: cumulative(180), last: raw({ input: 80, output: 0 }) }),
    ]);
    expect(both.examples[0]).toMatchObject({ confidence: "strong", transitionClassification: "both" });
    expect(both.transition.both).toBe(1);
    const bothResolution = resolveTokenCountDuplicatesV5([
      event(0, { total: cumulative(100) }),
      event(1, { rawFingerprint: "primary", total: cumulative(180), last: raw({ input: 80, output: 0 }) }),
      event(2, { rawFingerprint: "candidate", total: cumulative(180), last: raw({ input: 80, output: 0 }) }),
    ]);
    expect(bothResolution.events.map((item) => item.eventIndex)).toEqual([0, 1]);
    expect(bothResolution.diagnostics).toMatchObject({ semanticSnapshotDuplicateEvents: 1, semanticDuplicateCandidates: 0 });
  });

  it("keeps transition evidence unresolved when there is no previous cumulative state", () => {
    const result = analyzeTokenCountDuplicatesV5([
      event(1, { rawFingerprint: "primary", total: cumulative(100), last: raw({ input: 100, output: 0 }) }),
      event(2, { rawFingerprint: "candidate", total: cumulative(100), last: raw({ input: 100, output: 0 }) }),
    ]);

    expect(result.examples[0]).toMatchObject({ confidence: "probable", transitionClassification: "insufficient" });
    expect(result.transition.insufficient).toBe(1);
  });

  it("marks reset transitions and does not suppress a probable pair", () => {
    const result = analyzeTokenCountDuplicatesV5([
      event(0, { total: cumulative(200) }),
      event(1, { rawFingerprint: "primary", total: cumulative(100), last: raw({ input: 100, output: 0 }) }),
      event(2, { rawFingerprint: "candidate", total: cumulative(100), last: raw({ input: 100, output: 0 }) }),
    ]);

    expect(result.examples[0]).toMatchObject({ confidence: "probable", transitionClassification: "reset" });
    expect(result.transition.reset).toBe(1);
  });

  it("does not treat a transition matched by neither representation as safe suppression", () => {
    const events = [
      event(0, { total: cumulative(100) }),
      event(1, { rawFingerprint: "primary", total: cumulative(180), last: raw({ input: 70, output: 0 }) }),
      event(2, { rawFingerprint: "candidate", total: cumulative(180), last: raw({ input: 60, output: 0 }) }),
    ];
    const result = analyzeTokenCountDuplicatesV5(events);

    expect(result.examples[0]).toMatchObject({ confidence: "probable", transitionClassification: "neither" });
    expect(result.transition.neither).toBe(1);
    const resolved = resolveTokenCountDuplicatesV5(events);
    expect(resolved.events).toHaveLength(3);
    expect(resolved.suppressed).toHaveLength(0);
    expect(resolved.summary.unresolvedPairs).toBe(1);
  });

  it("records the whitelisted semantic difference for matching snapshots", () => {
    const result = analyzeTokenCountDuplicatesV5([
      event(1, { rawFingerprint: "primary", total: cumulative(100), semanticFingerprint: "same" }),
      event(2, { rawFingerprint: "candidate", total: cumulative(100), semanticFingerprint: "same" }),
    ]);

    expect(result.examples[0]?.semanticDiffPaths).toEqual(["payload.rate_limits"]);
  });

  it("fails closed when one semantic component requires multiple representatives", () => {
    const result = resolveTokenCountDuplicatesV5([
      event(0, { total: cumulative(100) }),
      event(1, { rawFingerprint: "first", total: cumulative(180), last: raw({ input: 70, output: 0 }) }),
      event(2, { rawFingerprint: "second", total: cumulative(180), last: raw({ input: 80, output: 0 }) }),
      event(3, { rawFingerprint: "third", total: cumulative(180), last: raw({ input: 80, output: 0 }) }),
    ]);

    expect(result.events).toHaveLength(4);
    expect(result.suppressed).toHaveLength(0);
    expect(result.diagnostics.duplicateConflicts).toBe(1);
    expect(result.safe).toBe(false);
  });
});
