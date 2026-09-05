import { totalTokens, zeroUsage, type TokenUsage } from "@lw-aiusage/core";
import { objectValue, stableEventId, stringValue } from "../shared/identity";
import { normalizeRawCounters, type CodexRawCounters } from "./accounting";
import type {
  CodexExtractedEvent,
  CodexExtractedFile,
  CodexUsageSource,
  ParserV4MirrorRecord,
  ParserV4MirrorSessionSummary,
} from "./rawAuditTypes";

interface ParserV4MirrorState {
  sessionId?: string;
  projectKey?: string;
  currentModel?: string;
  previousTotalUsage?: TokenUsage;
  forkedFromSessionId?: string;
  forkBaselineUsage?: TokenUsage;
  forkBaselineApplied?: boolean;
}

export interface ParserV4MirrorResult {
  records: Map<string, ParserV4MirrorRecord>;
  usage: TokenUsage;
  recordCount: number;
  sessionCount: number;
  sessions: Map<string, ParserV4MirrorSessionSummary>;
  days: Map<string, TokenUsage>;
  sources: Record<CodexUsageSource, TokenUsage>;
}

interface MirrorEventResult {
  state: ParserV4MirrorState;
  record?: ParserV4MirrorRecord;
}

const cloneUsage = (usage: TokenUsage): TokenUsage => ({ ...usage });
const hasTokens = (usage: TokenUsage): boolean =>
  Object.values(usage).some((value) => value > 0);

const subtractUsage = (
  current: TokenUsage,
  previous?: TokenUsage,
): TokenUsage => {
  if (!previous) return cloneUsage(current);
  return {
    inputTokens: Math.max(current.inputTokens - previous.inputTokens, 0),
    cachedInputTokens: Math.max(
      current.cachedInputTokens - previous.cachedInputTokens,
      0,
    ),
    cacheCreationInputTokens: Math.max(
      current.cacheCreationInputTokens - previous.cacheCreationInputTokens,
      0,
    ),
    outputTokens: Math.max(current.outputTokens - previous.outputTokens, 0),
    reasoningOutputTokens: Math.max(
      current.reasoningOutputTokens - previous.reasoningOutputTokens,
      0,
    ),
  };
};

const stringAt = (value: unknown, ...keys: string[]): string | undefined => {
  let current: unknown = value;
  for (const key of keys) current = objectValue(current)?.[key];
  return stringValue(current);
};

const firstString = (value: unknown, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const candidate = stringAt(value, key);
    if (candidate) return candidate;
  }
  return undefined;
};

const usageFrom = (value: CodexRawCounters | undefined): TokenUsage | undefined =>
  value ? normalizeRawCounters(value) : undefined;

const eventType = (event: CodexExtractedEvent): string | undefined =>
  stringValue(event.raw.type);

function mirrorEventV4(
  event: CodexExtractedEvent,
  context: ParserV4MirrorState,
  filePath: string,
  logicalId?: string,
): MirrorEventResult {
  const payload = objectValue(event.raw.payload) ?? event.raw;
  const msg = objectValue(payload.msg);
  const nestedInfo =
    objectValue(payload.info) ??
    objectValue(msg?.info) ??
    objectValue(event.raw.info);
  const model =
    stringAt(payload, "model") ??
    stringAt(nestedInfo, "model") ??
    stringAt(msg, "model") ??
    stringAt(event.raw, "model") ??
    context.currentModel;
  const type = eventType(event);
  const sessionId =
    (type === "session_meta" ? firstString(payload, "id") : undefined) ??
    firstString(payload, "session_id", "sessionId") ??
    firstString(msg, "session_id", "sessionId") ??
    firstString(event.raw, "session_id", "sessionId") ??
    context.sessionId;
  const projectKey =
    stringAt(payload, "cwd") ??
    stringAt(payload, "project") ??
    context.projectKey;
  const state: ParserV4MirrorState = {
    ...context,
    sessionId,
    projectKey,
    currentModel: model,
    previousTotalUsage: context.previousTotalUsage,
  };
  const forkedFromSessionId =
    firstString(payload, "forked_from_id", "forkedFromId") ??
    firstString(msg, "forked_from_id", "forkedFromId");
  if (forkedFromSessionId) {
    state.forkedFromSessionId = forkedFromSessionId;
    state.forkBaselineApplied = false;
  }

  const usageNode = event.last ?? event.total ?? event.flat;
  // The extractor has already validated the protocol node. The values here
  // are normalized CodexRawCounters, so applying the protocol-key gate again
  // would incorrectly reject them (input_tokens vs. input).
  if (!usageNode || !model)
    return { state };

  const normalizedTotal = usageFrom(event.total);
  if (normalizedTotal) state.previousTotalUsage = normalizedTotal;
  const previousTotal = context.previousTotalUsage ?? state.forkBaselineUsage;
  const usage = event.last
    ? event.total && state.forkBaselineUsage && !context.previousTotalUsage
      ? subtractUsage(
          usageFrom(event.total) ?? zeroUsage(),
          state.forkBaselineUsage,
        )
      : usageFrom(event.last) ?? zeroUsage()
    : event.total
      ? subtractUsage(usageFrom(event.total) ?? zeroUsage(), previousTotal)
      : usageFrom(event.flat) ?? zeroUsage();
  if (event.total && state.forkBaselineUsage && !context.previousTotalUsage)
    state.forkBaselineApplied = true;
  if (!hasTokens(usage)) return { state };

  const timestamp =
    typeof event.raw.timestamp === "number" && Number.isFinite(event.raw.timestamp)
      ? event.raw.timestamp < 10_000_000_000
        ? event.raw.timestamp * 1000
        : event.raw.timestamp
      : typeof event.raw.timestamp === "string" && Number.isFinite(Date.parse(event.raw.timestamp))
        ? Date.parse(event.raw.timestamp)
        : Date.now();
  const stableSourceId = logicalId ?? state.sessionId ?? filePath;
  const recordId = stableEventId("codex", stableSourceId, event.raw, {
    timestamp: event.raw.timestamp,
    turnId: stringAt(payload, "turn_id", "turnId"),
    responseId: stringAt(payload, "response_id", "responseId"),
    total: event.total ?? event.last ?? event.flat,
  });
  return {
    state,
    record: {
      id: recordId,
      sessionId,
      timestamp,
      model,
      sourceKind: event.source ?? "flat-payload",
      usage,
    },
  };
}

const dayOf = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const addUsage = (target: TokenUsage, value: TokenUsage): void => {
  target.inputTokens += value.inputTokens;
  target.cachedInputTokens += value.cachedInputTokens;
  target.cacheCreationInputTokens += value.cacheCreationInputTokens;
  target.outputTokens += value.outputTokens;
  target.reasoningOutputTokens += value.reasoningOutputTokens;
};

const emptySources = (): Record<CodexUsageSource, TokenUsage> => ({
  "token-count": zeroUsage(),
  "nested-info-non-token-count": zeroUsage(),
  "payload-usage": zeroUsage(),
  "flat-payload": zeroUsage(),
});

export function replayCodexV4(
  files: readonly CodexExtractedFile[],
): ParserV4MirrorResult {
  const records = new Map<string, ParserV4MirrorRecord>();
  const sessionTotals = new Map<string, TokenUsage>();
  const orderedFiles = [...files].sort((left, right) =>
    left.entry.path.localeCompare(right.entry.path),
  );

  for (const file of orderedFiles) {
    let state: ParserV4MirrorState = { projectKey: "unknown" };
    for (const event of file.events) {
      if (state.forkedFromSessionId && !state.forkBaselineUsage)
        state.forkBaselineUsage = sessionTotals.get(state.forkedFromSessionId);
      const result = mirrorEventV4(
        event,
        state,
        file.entry.path,
        file.peekLogicalId,
      );
      state = result.state;
      if (state.forkedFromSessionId && !state.forkBaselineUsage)
        state.forkBaselineUsage = sessionTotals.get(state.forkedFromSessionId);
      if (state.sessionId && state.previousTotalUsage)
        sessionTotals.set(state.sessionId, cloneUsage(state.previousTotalUsage));
      if (result.record) records.set(result.record.id, result.record);
    }
  }

  const usage = zeroUsage();
  const sessions = new Map<string, ParserV4MirrorSessionSummary>();
  const days = new Map<string, TokenUsage>();
  const sources = emptySources();
  for (const record of records.values()) {
    addUsage(usage, record.usage);
    if (record.sessionId) {
      const session = sessions.get(record.sessionId) ?? {
        sessionId: record.sessionId,
        recordCount: 0,
        usage: zeroUsage(),
      };
      session.recordCount += 1;
      addUsage(session.usage, record.usage);
      sessions.set(record.sessionId, session);
    }
    const day = days.get(dayOf(record.timestamp)) ?? zeroUsage();
    addUsage(day, record.usage);
    days.set(dayOf(record.timestamp), day);
    addUsage(sources[record.sourceKind], record.usage);
  }
  return {
    records,
    usage,
    recordCount: records.size,
    sessionCount: sessions.size,
    sessions,
    days,
    sources,
  };
}

export { mirrorEventV4 };
