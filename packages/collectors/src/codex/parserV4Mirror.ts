/**
 * Frozen compatibility mirror for Codex parser v4.
 *
 * Keep this implementation stable when parser v5 changes. It is an
 * independent historical accounting oracle for validating stored records.
 */
import { totalTokens, zeroUsage, type TokenUsage } from "@lw-aiusage/core";
import { objectValue, stableEventId, stringValue } from "../shared/identity";
import type {
  CodexExtractedEvent,
  CodexExtractedFile,
  CodexUsageSource,
  ParserV4MirrorRecord,
  ParserV4MirrorSessionSummary,
} from "./rawAuditTypes";
import { canonicalizeMirrorFiles } from "./mirrorFileReconcile";

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
  discoveredFileCount: number;
  canonicalFileCount: number;
  shadowDuplicateCount: number;
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

interface V4RawUsage {
  input: number;
  cachedInput: number;
  cacheCreationInput: number;
  output: number;
  reasoningOutput: number;
  total: number;
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

const firstNumberV4 = (value: unknown, ...keys: string[]): number => {
  const object = objectValue(value);
  if (!object) return 0;
  for (const key of keys) {
    const candidate = object[key];
    if (typeof candidate === "number" && Number.isFinite(candidate))
      return candidate;
  }
  return 0;
};

const rawUsageOfV4 = (value: unknown): V4RawUsage => ({
  input: firstNumberV4(value, "input_tokens", "inputTokens"),
  cachedInput: firstNumberV4(value, "cached_input_tokens", "cachedInputTokens"),
  cacheCreationInput: firstNumberV4(
    value,
    "cache_write_input_tokens",
    "cache_creation_input_tokens",
    "cacheCreationInputTokens",
  ),
  output: firstNumberV4(value, "output_tokens", "outputTokens"),
  reasoningOutput: firstNumberV4(value, "reasoning_output_tokens"),
  total: firstNumberV4(value, "total_tokens", "totalTokens"),
});

const normalizeUsageV4 = (raw: V4RawUsage): TokenUsage => {
  const usage = zeroUsage();
  usage.cachedInputTokens = raw.cachedInput;
  usage.cacheCreationInputTokens = raw.cacheCreationInput;
  usage.inputTokens = Math.max(raw.input - raw.cachedInput, 0);
  usage.reasoningOutputTokens = raw.reasoningOutput;
  usage.outputTokens = Math.max(raw.output - raw.reasoningOutput, 0);
  if (
    raw.total > 0 &&
    raw.input === 0 &&
    raw.output === 0 &&
    raw.reasoningOutput === 0 &&
    raw.cachedInput === 0
  ) {
    usage.inputTokens = raw.total;
  }
  return usage;
};

const hasUsageFieldsV4 = (value: unknown): boolean => {
  const object = objectValue(value);
  return !!object && [
    "input_tokens",
    "inputTokens",
    "cached_input_tokens",
    "output_tokens",
    "outputTokens",
    "total_tokens",
    "totalTokens",
    "reasoning_output_tokens",
  ].some((key) => key in object);
};

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
  const lastNode = nestedInfo?.last_token_usage ?? nestedInfo?.lastTokenUsage;
  const totalNode = nestedInfo?.total_token_usage ?? nestedInfo?.totalTokenUsage;
  const flatUsageNode =
    objectValue(payload.usage) ??
    (hasUsageFieldsV4(payload) ? payload : undefined);
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
    context.projectKey ??
    "unknown";
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

  const rawUsageNode = lastNode ?? totalNode ?? flatUsageNode;
  if (!rawUsageNode || !model || !hasUsageFieldsV4(rawUsageNode))
    return { state };

  const normalizedTotal = totalNode && hasUsageFieldsV4(totalNode)
    ? normalizeUsageV4(rawUsageOfV4(totalNode))
    : undefined;
  const normalizedLast = lastNode && hasUsageFieldsV4(lastNode)
    ? normalizeUsageV4(rawUsageOfV4(lastNode))
    : undefined;
  const normalizedFlat = flatUsageNode && hasUsageFieldsV4(flatUsageNode)
    ? normalizeUsageV4(rawUsageOfV4(flatUsageNode))
    : undefined;
  if (normalizedTotal) state.previousTotalUsage = normalizedTotal;
  const previousTotal = context.previousTotalUsage ?? state.forkBaselineUsage;
  const usage = lastNode
    ? totalNode && normalizedTotal && state.forkBaselineUsage && !context.previousTotalUsage
      ? subtractUsage(
          normalizedTotal ?? zeroUsage(),
          state.forkBaselineUsage,
        )
      : normalizedLast ?? zeroUsage()
    : totalNode && normalizedTotal
      ? subtractUsage(normalizedTotal, previousTotal)
      : normalizedFlat ?? zeroUsage();
  if (totalNode && normalizedTotal && state.forkBaselineUsage && !context.previousTotalUsage)
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
    total: totalNode ?? rawUsageNode,
  });
  return {
    state,
    record: {
      id: recordId,
      sessionId,
      timestamp,
      model,
      projectKey,
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
  const canonicalFiles = canonicalizeMirrorFiles(files);
  const orderedFiles = [...canonicalFiles].sort((left, right) =>
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
    discoveredFileCount: files.length,
    canonicalFileCount: canonicalFiles.length,
    shadowDuplicateCount: files.length - canonicalFiles.length,
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
