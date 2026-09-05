import { totalTokens, zeroUsage, type TokenUsage } from "@lw-aiusage/core";
import type { RuntimePlatform, FileEntry } from "@lw-aiusage/platform";
import {
  objectValue,
  stableEventId,
  stableHash,
  stringValue,
} from "../shared/identity";
import { parseJsonl } from "../shared/jsonl";
import {
  counterDecrease,
  copyRawCounters,
  normalizeRawCounters,
  positiveRawDelta,
  rawCounterTotal,
  rawCountersFrom,
  sameRawCounters,
  type CodexRawCounters,
} from "./accounting";
import type { UnknownCodexEvent } from "./types";
import type { CodexUsageSource } from "./rawAuditTypes";
import { snapshotCodexSource, type CodexSourceSnapshot } from "./rawExtractor";
import {
  addCodexEventTaxonomy,
  codexEventTypeInfo,
  emptyCodexEventTaxonomy,
  type CodexEventTaxonomySummary,
  type CodexEventTypeInfo,
} from "./eventTaxonomy";

export type CodexTokenEventClass =
  | "normal-delta"
  | "duplicate-snapshot"
  | "counter-reset"
  | "last-delta-match"
  | "last-delta-mismatch"
  | "last-only"
  | "total-only"
  | "fork-first"
  | "fork-baseline-unresolved";
export type { CodexUsageSource } from "./rawAuditTypes";
export interface CodexRawAuditDay {
  day: string;
  currentTotal: number;
  currentEquivalentTotal: number;
  lastUsageTotal: number;
  totalDeltaTotal: number;
  segmentedTotalDeltaTotal: number;
  forkAwareTotal: number;
  parserEquivalentV4Total: number;
  hybridCanonicalTotal: number;
}
export interface CodexRawAuditAnomalySummary {
  repeatedTotalSnapshot: number;
  repeatedTotalWithNonZeroLast: number;
  totalCounterDecrease: number;
  componentCounterDecrease: number;
  lastVsDeltaMismatch: number;
  missingTimestamp: number;
}
export interface CodexUsageSourceCount {
  events: number;
  rawSnapshotTokens: number;
  parserEquivalentTokens: number;
  hybridTokens: number;
}
export interface CodexUsageSources {
  tokenCount: CodexUsageSourceCount;
  nestedInfoNonTokenCount: CodexUsageSourceCount;
  payloadUsage: CodexUsageSourceCount;
  flatPayloadUsage: CodexUsageSourceCount;
  ignoredNoModel: CodexUsageSourceCount;
  zeroUsage: number;
}
export interface CodexResetAuditItem {
  sessionHash: string;
  sequence: number;
  timestamp?: number;
  previous: CodexRawCounters;
  current: CodexRawCounters;
  last?: CodexRawCounters;
  previousTotalTokens: number;
  currentTotalTokens: number;
  lastTokens: number;
  resetComponents: string[];
  currentEqualsLast: boolean;
  currentContainsLast: boolean;
  precedingEventType?: string;
  precedingOuterType?: string;
  precedingSemanticType?: string;
  resetCauseCandidate?:
    "response-boundary" | "model-change" | "resume" | "unknown";
  lastMatchesCurrent?: boolean;
  modelBefore?: string;
  modelAfter?: string;
  timeGapMs?: number;
  segmentIndex: number;
}
export interface CodexSessionAuditSummary {
  sessionHash: string;
  eventCount: number;
  resetCount: number;
  duplicateSnapshotCount: number;
  lastUsageTokens: number;
  segmentedDeltaTokens: number;
  terminalTokens: number;
  parserEquivalentV4Tokens: number;
  hybridCanonicalTokens: number;
}
export interface CodexRawAuditReport {
  auditVersion: 3;
  parserVersion: 4;
  accounting: "codex-accounting-audit-v3";
  generatedAt: number;
  files: number;
  canonicalFiles: number;
  duplicateFiles: number;
  sessions: number;
  events: {
    total: number;
    usageEvents: number;
    tokenCount: number;
    withLastUsage: number;
    withTotalUsage: number;
    withBoth: number;
    missingTimestamp: number;
    totalCounterDecrease: number;
    repeatedTotalSnapshot: number;
    repeatedTotalWithNonZeroLast: number;
    lastVsDeltaMismatch: number;
  };
  usageSources: CodexUsageSources;
  eventClasses: Record<CodexTokenEventClass, number>;
  mismatchBuckets: Record<string, number>;
  fork: {
    sessions: number;
    baselineResolved: number;
    baselineMissing: number;
    childFirstLastResolved: number;
    parentAtForkResolved: number;
  };
  methods: {
    lastUsageSum: TokenUsage;
    segmentedTotalDelta: TokenUsage;
    totalDeltaSum: TokenUsage;
    currentEquivalent: TokenUsage;
    parserEquivalentV4AllEvents: TokenUsage;
    parserEquivalentV4Unique: TokenUsage;
    parserEquivalentV4UniqueRecordCount: number;
    sessionTerminalTotal: TokenUsage;
    forkAwareTotalDelta: TokenUsage;
    hybridCanonical: TokenUsage;
  };
  discrepancy: {
    lastMinusTotalDelta: TokenUsage;
    lastMinusTotalDeltaTotal: number;
    absoluteMismatchTokens: number;
    lastGreaterTokens: number;
    deltaGreaterTokens: number;
    repeatedLastTokens: number;
    positiveMismatchTokens: number;
  };
  reconciliation: {
    firstSnapshotTotalEqualsLast: number;
    firstSnapshotTotalGreaterThanLast: number;
    firstSnapshotDifferenceTokens: number;
    parserEquivalentV4MinusHybridTokens: number;
    segmentedDeltaMinusHybridTokens: number;
    terminalMinusHybridTokens: number;
  };
  timestampSources: {
    explicit: number;
    inherited: number;
    session: number;
    fileModified: number;
    unresolved: number;
  };
  eventTaxonomy?: CodexEventTaxonomySummary;
  resets: {
    count: number;
    items: CodexResetAuditItem[];
    byPreviousEventType: Record<string, number>;
    currentEqualsLast?: number;
    currentDiffersFromLast?: number;
  };
  sessionRankings: {
    largestSegmentTerminalDifference: CodexSessionAuditSummary[];
    largestV4HybridDifference: CodexSessionAuditSummary[];
  };
  peakDays: CodexRawAuditDay[];
  anomalies: CodexRawAuditAnomalySummary;
}

export type { CodexSourceSnapshot } from "./rawExtractor";
export { snapshotCodexSource } from "./rawExtractor";

const CHUNK_BYTES = 1024 * 1024;
const isJsonl = (entry: FileEntry): boolean =>
  entry.isFile && entry.name.toLowerCase().endsWith(".jsonl");
const isArchived = (path: string): boolean =>
  /[\\/]archived_sessions[\\/]/i.test(path);
const emptyRaw = (): CodexRawCounters => ({
  input: 0,
  cachedInput: 0,
  cacheCreationInput: 0,
  output: 0,
  reasoningOutput: 0,
  total: 0,
});
const addRaw = (target: CodexRawCounters, value: CodexRawCounters): void => {
  target.input += value.input;
  target.cachedInput += value.cachedInput;
  target.cacheCreationInput += value.cacheCreationInput;
  target.output += value.output;
  target.reasoningOutput += value.reasoningOutput;
  target.total += value.total;
};
const addTokenUsage = (target: TokenUsage, value: TokenUsage): void => {
  target.inputTokens += value.inputTokens;
  target.cachedInputTokens += value.cachedInputTokens;
  target.cacheCreationInputTokens += value.cacheCreationInputTokens;
  target.outputTokens += value.outputTokens;
  target.reasoningOutputTokens += value.reasoningOutputTokens;
};
const subtractTokenUsage = (target: TokenUsage, value: TokenUsage): void => {
  target.inputTokens -= value.inputTokens;
  target.cachedInputTokens -= value.cachedInputTokens;
  target.cacheCreationInputTokens -= value.cacheCreationInputTokens;
  target.outputTokens -= value.outputTokens;
  target.reasoningOutputTokens -= value.reasoningOutputTokens;
};
const normalized = (raw: CodexRawCounters): TokenUsage =>
  normalizeRawCounters(raw);
const tokenValue = (raw: CodexRawCounters | undefined): number =>
  raw ? totalTokens(normalized(raw)) : 0;
const mismatchBucket = (value: number): string =>
  value === 0
    ? "0"
    : value <= 1_000
      ? "1-1K"
      : value <= 10_000
        ? "1K-10K"
        : value <= 100_000
          ? "10K-100K"
          : value <= 1_000_000
            ? "100K-1M"
            : ">1M";
const emptyClasses = (): Record<CodexTokenEventClass, number> => ({
  "normal-delta": 0,
  "duplicate-snapshot": 0,
  "counter-reset": 0,
  "last-delta-match": 0,
  "last-delta-mismatch": 0,
  "last-only": 0,
  "total-only": 0,
  "fork-first": 0,
  "fork-baseline-unresolved": 0,
});
const hashSession = (value: string): string => {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};
const resetCauseCandidate = (
  event: RawEvent,
): "response-boundary" | "model-change" | "resume" | "unknown" => {
  if (
    event.precedingSemanticType === "response_item" ||
    event.precedingOuterType === "response_item"
  )
    return "response-boundary";
  if (event.modelBefore && event.model && event.modelBefore !== event.model)
    return "model-change";
  if (
    event.precedingSemanticType?.toLowerCase().includes("resume") ||
    event.precedingOuterType?.toLowerCase().includes("resume")
  )
    return "resume";
  return "unknown";
};

interface RawEvent {
  sessionId: string;
  forkedFromId?: string;
  source: CodexUsageSource;
  usage?: CodexRawCounters;
  lastUsage?: CodexRawCounters;
  flatUsage?: CodexRawCounters;
  timestamp?: number;
  timestampSource:
    "explicit" | "inherited" | "session" | "file-modified" | "unresolved";
  sequence: number;
  eventIndex: number;
  eventType?: string;
  outerType?: string;
  payloadType?: string;
  messageType?: string;
  semanticType?: string;
  isTokenCount: boolean;
  model?: string;
  previousEventType?: string;
  precedingOuterType?: string;
  precedingSemanticType?: string;
  modelBefore?: string;
  timeGapMs?: number;
  segmentDelta?: CodexRawCounters;
  hybridContribution?: CodexRawCounters;
  parserEquivalentContribution?: CodexRawCounters;
  stableId?: string;
  eventClass?: CodexTokenEventClass;
  ignoredNoModel?: boolean;
}
interface RawFile {
  entry: FileEntry;
  totalEvents: number;
  sessionId?: string;
  forkedFromId?: string;
  sessionTimestamp?: number;
  events: RawEvent[];
  taxonomy: CodexEventTypeInfo[];
}
interface SessionAccounting {
  file: RawFile;
  segmentedTotal: CodexRawCounters;
  finalTotal?: CodexRawCounters;
}
const usageFields = [
  "input_tokens",
  "inputTokens",
  "cached_input_tokens",
  "cachedInputTokens",
  "output_tokens",
  "outputTokens",
  "total_tokens",
  "totalTokens",
  "reasoning_output_tokens",
];
const hasUsageFields = (value: unknown): boolean => {
  const object = objectValue(value);
  return !!object && usageFields.some((key) => key in object);
};
const tokenInfo = (
  event: UnknownCodexEvent,
): { last?: CodexRawCounters; total?: CodexRawCounters } => {
  const payload = objectValue(event.payload) ?? event;
  const msg = objectValue(payload.msg);
  const info =
    objectValue(payload.info) ??
    objectValue(msg?.info) ??
    objectValue(event.info);
  return {
    last: rawCountersFrom(info?.last_token_usage ?? info?.lastTokenUsage),
    total: rawCountersFrom(info?.total_token_usage ?? info?.totalTokenUsage),
  };
};
const timestampOf = (event: UnknownCodexEvent): number | undefined => {
  const payload = objectValue(event.payload);
  const msg = objectValue(payload?.msg);
  for (const value of [event.timestamp, payload?.timestamp, msg?.timestamp]) {
    if (typeof value === "number" && Number.isFinite(value))
      return value < 10_000_000_000 ? value * 1000 : value;
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
};
const eventModel = (
  event: UnknownCodexEvent,
  current?: string,
): string | undefined => {
  const payload = objectValue(event.payload) ?? event;
  const msg = objectValue(payload.msg);
  const info =
    objectValue(payload.info) ??
    objectValue(msg?.info) ??
    objectValue(event.info);
  return (
    stringValue(payload.model) ??
    stringValue(info?.model) ??
    stringValue(msg?.model) ??
    stringValue(event.model) ??
    current
  );
};
const eventTypeOf = (event: UnknownCodexEvent): string | undefined =>
  codexEventTypeInfo(event).semanticType;
const sourceInfo = (
  event: UnknownCodexEvent,
  taxonomy = codexEventTypeInfo(event),
): {
  source?: CodexUsageSource;
  last?: CodexRawCounters;
  total?: CodexRawCounters;
  flat?: CodexRawCounters;
} => {
  const payload = objectValue(event.payload) ?? event;
  const msg = objectValue(payload.msg);
  const info =
    objectValue(payload.info) ??
    objectValue(msg?.info) ??
    objectValue(event.info);
  const last = rawCountersFrom(info?.last_token_usage ?? info?.lastTokenUsage);
  const total = rawCountersFrom(
    info?.total_token_usage ?? info?.totalTokenUsage,
  );
  if (taxonomy.isTokenCount) return { source: "token-count", last, total };
  if (last || total)
    return { source: "nested-info-non-token-count", last, total };
  const payloadUsage = rawCountersFrom(payload.usage);
  if (payloadUsage && hasUsageFields(payload.usage))
    return { source: "payload-usage", flat: payloadUsage };
  const flat = hasUsageFields(payload) ? rawCountersFrom(payload) : undefined;
  return flat ? { source: "flat-payload", flat } : {};
};
const sessionMeta = (
  event: UnknownCodexEvent,
): { id?: string; forkedFromId?: string; timestamp?: number } => {
  const payload = objectValue(event.payload) ?? event;
  return {
    id:
      stringValue(payload.id) ??
      stringValue(payload.session_id) ??
      stringValue(payload.sessionId),
    forkedFromId:
      stringValue(payload.forked_from_id) ?? stringValue(payload.forkedFromId),
    timestamp: timestampOf(event),
  };
};
async function recursiveJsonl(
  platform: RuntimePlatform,
  root: string,
): Promise<FileEntry[]> {
  if (!(await platform.fs.exists(root))) return [];
  const entries = await platform.fs.list(root);
  const files: FileEntry[] = [];
  for (const entry of entries)
    if (isJsonl(entry)) files.push(entry);
    else if (entry.isDirectory)
      files.push(...(await recursiveJsonl(platform, entry.path)));
  return files;
}
async function readFile(
  platform: RuntimePlatform,
  entry: FileEntry,
  maxSize = entry.size,
): Promise<RawFile> {
  const result: RawFile = { entry, totalEvents: 0, events: [], taxonomy: [] };
  let offset = 0;
  let pendingText = "";
  let inheritedTimestamp: number | undefined;
  let sequence = 0;
  let eventIndex = 0;
  let previousEventType: string | undefined;
  let previousOuterType: string | undefined;
  let previousSemanticType: string | undefined;
  let previousModel: string | undefined;
  let previousTimestamp: number | undefined;
  let currentModel: string | undefined;
  const decoder = new TextDecoder();
  const consume = (event: UnknownCodexEvent): void => {
    const index = eventIndex++;
    result.totalEvents += 1;
    const taxonomy = codexEventTypeInfo(event);
    result.taxonomy.push(taxonomy);
    const explicitTimestamp = timestampOf(event);
    const type = taxonomy.semanticType;
    if (type === "session_meta") {
      const meta = sessionMeta(event);
      result.sessionId ??= meta.id;
      result.forkedFromId ??= meta.forkedFromId;
      result.sessionTimestamp ??= meta.timestamp;
    }
    const payload = objectValue(event.payload) ?? event;
    const msg = objectValue(payload.msg);
    result.forkedFromId ??=
      stringValue(payload.forked_from_id) ??
      stringValue(payload.forkedFromId) ??
      stringValue(msg?.forked_from_id) ??
      stringValue(msg?.forkedFromId);
    const resolvedModel = eventModel(event, currentModel);
    if (resolvedModel) currentModel = resolvedModel;
    if (explicitTimestamp !== undefined) inheritedTimestamp = explicitTimestamp;
    const source = sourceInfo(event, taxonomy);
    const base = {
      previousEventType,
      precedingOuterType: previousOuterType,
      precedingSemanticType: previousSemanticType,
      modelBefore: previousModel,
      timeGapMs:
        explicitTimestamp !== undefined && previousTimestamp !== undefined
          ? explicitTimestamp - previousTimestamp
          : undefined,
    };
    if (!source.source) {
      previousEventType = type ?? previousEventType;
      previousOuterType = taxonomy.outerType ?? previousOuterType;
      previousSemanticType = taxonomy.semanticType ?? previousSemanticType;
      previousModel = resolvedModel ?? previousModel;
      previousTimestamp = explicitTimestamp ?? previousTimestamp;
      return;
    }
    const timestamp =
      explicitTimestamp ??
      inheritedTimestamp ??
      result.sessionTimestamp ??
      (entry.modifiedAt || undefined);
    const timestampSource =
      explicitTimestamp !== undefined
        ? "explicit"
        : inheritedTimestamp !== undefined
          ? "inherited"
          : result.sessionTimestamp !== undefined
            ? "session"
            : entry.modifiedAt
              ? "file-modified"
              : "unresolved";
    const usageNode = source.total ?? source.last ?? source.flat;
    result.events.push({
      ...base,
      sessionId: result.sessionId ?? `file:${entry.path}`,
      forkedFromId: result.forkedFromId,
      source: source.source,
      usage: source.total,
      lastUsage: source.last,
      flatUsage: source.flat,
      timestamp,
      timestampSource,
      sequence,
      eventIndex: index,
      eventType: type,
      outerType: taxonomy.outerType,
      payloadType: taxonomy.payloadType,
      messageType: taxonomy.messageType,
      semanticType: taxonomy.semanticType,
      isTokenCount: taxonomy.isTokenCount,
      model: resolvedModel,
      stableId: stableEventId("codex", result.sessionId ?? entry.path, event, {
        timestamp: event.timestamp,
        turnId: stringValue(payload.turn_id) ?? stringValue(payload.turnId),
        responseId:
          stringValue(payload.response_id) ?? stringValue(payload.responseId),
        total: usageNode,
      }),
      ignoredNoModel: !resolvedModel,
    });
    sequence += 1;
    previousEventType = type ?? previousEventType;
    previousOuterType = taxonomy.outerType ?? previousOuterType;
    previousSemanticType = taxonomy.semanticType ?? previousSemanticType;
    previousModel = resolvedModel ?? previousModel;
    previousTimestamp = timestamp ?? previousTimestamp;
  };
  const consumeText = (text: string): void => {
    const parsed = parseJsonl<UnknownCodexEvent>(text, pendingText);
    pendingText = parsed.pendingText;
    for (const event of parsed.values) consume(event);
  };
  while (offset < maxSize) {
    const end = Math.min(maxSize, offset + CHUNK_BYTES);
    const bytes = await platform.fs.readRange(entry.path, offset, end);
    consumeText(decoder.decode(new Uint8Array(bytes), { stream: true }));
    offset = end;
  }
  const tail = decoder.decode();
  if (tail) consumeText(tail);
  if (pendingText.trim()) consumeText("\n");
  for (const event of result.events)
    event.sessionId = result.sessionId ?? event.sessionId;
  return result;
}
function preferredFile(left: RawFile, right: RawFile): RawFile {
  if (left.entry.size !== right.entry.size)
    return left.entry.size > right.entry.size ? left : right;
  if (left.entry.modifiedAt !== right.entry.modifiedAt)
    return left.entry.modifiedAt > right.entry.modifiedAt ? left : right;
  if (isArchived(left.entry.path) !== isArchived(right.entry.path))
    return isArchived(left.entry.path) ? left : right;
  return left.entry.path.localeCompare(right.entry.path) <= 0 ? left : right;
}
function dayOf(timestamp: number | undefined): string | undefined {
  if (timestamp === undefined) return undefined;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function parentBaselineAt(
  parent: SessionAccounting,
  timestamp: number | undefined,
): CodexRawCounters | undefined {
  if (timestamp === undefined) return undefined;
  let candidate: CodexRawCounters | undefined;
  for (const event of parent.file.events)
    if (
      event.usage &&
      event.timestamp !== undefined &&
      event.timestamp <= timestamp
    )
      candidate = event.usage;
  return candidate ? copyRawCounters(candidate) : undefined;
}
function resetComponents(
  current: CodexRawCounters,
  previous: CodexRawCounters,
): string[] {
  return (
    [
      "input",
      "cachedInput",
      "cacheCreationInput",
      "output",
      "reasoningOutput",
    ] as const
  ).filter((key) => current[key] < previous[key]);
}
function usageDifference(left: TokenUsage, right: TokenUsage): number {
  return totalTokens(left) - totalTokens(right);
}

export async function auditCodexRaw(
  platform: RuntimePlatform,
  onProgress?: (current: number, total: number) => void,
  options?: { snapshot?: CodexSourceSnapshot },
): Promise<CodexRawAuditReport> {
  const home = await platform.paths.home();
  const roots = [`${home}/.codex/sessions`, `${home}/.codex/archived_sessions`];
  const discovered = (
    await Promise.all(roots.map((root) => recursiveJsonl(platform, root)))
  ).flat();
  const entries = options?.snapshot
    ? options.snapshot.files.map((file) => ({
        path: file.path,
        name: file.path.split(/[\\/]/).at(-1) ?? file.path,
        isFile: true,
        isDirectory: false,
        size: file.size,
        modifiedAt: file.modifiedAt,
      }))
    : discovered;
  const files: RawFile[] = [];
  for (const [index, entry] of entries.entries()) {
    const snapshotFile = options?.snapshot?.files.find(
      (file) => file.path === entry.path,
    );
    files.push(
      await readFile(platform, entry, snapshotFile?.size ?? entry.size),
    );
    onProgress?.(index + 1, entries.length);
  }
  const bySession = new Map<string, RawFile>();
  for (const file of files) {
    const key = file.sessionId ?? `file:${file.entry.path}`;
    const current = bySession.get(key);
    if (!current) bySession.set(key, file);
    else bySession.set(key, preferredFile(current, file));
  }
  const canonical = [...bySession.values()];
  const lastSum = zeroUsage();
  const deltaSum = zeroUsage();
  const currentSum = zeroUsage();
  const parserV4RawSum = zeroUsage();
  const terminalSum = zeroUsage();
  const forkAwareSum = zeroUsage();
  const hybridSum = zeroUsage();
  const parserMirror = new Map<string, TokenUsage>();
  const timestampSources = {
    explicit: 0,
    inherited: 0,
    session: 0,
    fileModified: 0,
    unresolved: 0,
  };
  const dayMap = new Map<string, CodexRawAuditDay>();
  const eventClasses = emptyClasses();
  const mismatchBuckets: Record<string, number> = {};
  const sourceCounts: CodexUsageSources = {
    tokenCount: {
      events: 0,
      rawSnapshotTokens: 0,
      parserEquivalentTokens: 0,
      hybridTokens: 0,
    },
    nestedInfoNonTokenCount: {
      events: 0,
      rawSnapshotTokens: 0,
      parserEquivalentTokens: 0,
      hybridTokens: 0,
    },
    payloadUsage: {
      events: 0,
      rawSnapshotTokens: 0,
      parserEquivalentTokens: 0,
      hybridTokens: 0,
    },
    flatPayloadUsage: {
      events: 0,
      rawSnapshotTokens: 0,
      parserEquivalentTokens: 0,
      hybridTokens: 0,
    },
    ignoredNoModel: {
      events: 0,
      rawSnapshotTokens: 0,
      parserEquivalentTokens: 0,
      hybridTokens: 0,
    },
    zeroUsage: 0,
  };
  const eventTaxonomy = emptyCodexEventTaxonomy();
  const sessions = new Map<string, SessionAccounting>();
  const resetItems: CodexResetAuditItem[] = [];
  const resetByType: Record<string, number> = {};
  const rankings: CodexSessionAuditSummary[] = [];
  let usageEvents = 0;
  let tokenCount = 0;
  let withLastUsage = 0;
  let withTotalUsage = 0;
  let withBoth = 0;
  let totalCounterDecrease = 0;
  let componentCounterDecrease = 0;
  let repeatedTotalSnapshot = 0;
  let repeatedTotalWithNonZeroLast = 0;
  let lastVsDeltaMismatch = 0;
  let repeatedLastTokens = 0;
  let positiveMismatchTokens = 0;
  let absoluteMismatchTokens = 0;
  let lastGreaterTokens = 0;
  let deltaGreaterTokens = 0;
  let firstSnapshotTotalEqualsLast = 0;
  let firstSnapshotTotalGreaterThanLast = 0;
  let firstSnapshotDifferenceTokens = 0;
  let resetCurrentEqualsLast = 0;
  let resetCurrentDiffersFromLast = 0;
  for (const file of canonical)
    for (const taxonomy of file.taxonomy)
      addCodexEventTaxonomy(eventTaxonomy, taxonomy);
  for (const file of canonical) {
    const segmentedTotal = emptyRaw();
    let previous: CodexRawCounters | undefined;
    let lastSeenTotal: CodexRawCounters | undefined;
    let segmentIndex = 0;
    const key = file.sessionId ?? file.entry.path;
    const sessionSummary: CodexSessionAuditSummary = {
      sessionHash: hashSession(key),
      eventCount: 0,
      resetCount: 0,
      duplicateSnapshotCount: 0,
      lastUsageTokens: 0,
      segmentedDeltaTokens: 0,
      terminalTokens: 0,
      parserEquivalentV4Tokens: 0,
      hybridCanonicalTokens: 0,
    };
    for (const event of file.events) {
      usageEvents += 1;
      tokenCount += event.source === "token-count" ? 1 : 0;
      const sourceKey =
        event.source === "token-count"
          ? "tokenCount"
          : event.source === "nested-info-non-token-count"
            ? "nestedInfoNonTokenCount"
            : event.source === "payload-usage"
              ? "payloadUsage"
              : "flatPayloadUsage";
      const rawCandidate = event.usage ?? event.lastUsage ?? event.flatUsage;
      const candidateTokens = tokenValue(rawCandidate);
      sourceCounts[sourceKey].events += 1;
      sourceCounts[sourceKey].rawSnapshotTokens += candidateTokens;
      if (event.ignoredNoModel) {
        sourceCounts.ignoredNoModel.events += 1;
        sourceCounts.ignoredNoModel.rawSnapshotTokens += candidateTokens;
      }
      if (candidateTokens === 0) {
        sourceCounts.zeroUsage += 1;
        continue;
      }
      sessionSummary.eventCount += 1;
      if (event.lastUsage) withLastUsage += 1;
      if (event.usage) withTotalUsage += 1;
      if (event.lastUsage && event.usage) withBoth += 1;
      timestampSources[
        event.timestampSource === "file-modified"
          ? "fileModified"
          : event.timestampSource
      ] += 1;
      const total = event.usage;
      const last = event.lastUsage;
      let delta: CodexRawCounters | undefined;
      let hybrid: CodexRawCounters | undefined;
      let eventClass: CodexTokenEventClass;
      if (total) {
        const reset = previous ? counterDecrease(total, previous) : false;
        const duplicate = previous ? sameRawCounters(total, previous) : false;
        if (reset) {
          totalCounterDecrease +=
            rawCounterTotal(total) < rawCounterTotal(previous!) ? 1 : 0;
          componentCounterDecrease += 1;
          segmentIndex += 1;
          delta = positiveRawDelta(total);
          hybrid = last ? copyRawCounters(last) : copyRawCounters(delta);
          eventClass = "counter-reset";
          const preceding = event.previousEventType ?? "unknown";
          resetByType[preceding] = (resetByType[preceding] ?? 0) + 1;
          const currentEqualsLast = !!last && sameRawCounters(total, last);
          if (currentEqualsLast) resetCurrentEqualsLast += 1;
          else resetCurrentDiffersFromLast += 1;
          resetItems.push({
            sessionHash: hashSession(key),
            sequence: event.sequence,
            timestamp: event.timestamp,
            previous: copyRawCounters(previous!),
            current: copyRawCounters(total),
            last: last ? copyRawCounters(last) : undefined,
            previousTotalTokens: tokenValue(previous),
            currentTotalTokens: tokenValue(total),
            lastTokens: tokenValue(last),
            resetComponents: resetComponents(total, previous!),
            currentEqualsLast,
            currentContainsLast:
              !!last && resetComponents(total, last).length === 0,
            precedingEventType: preceding,
            precedingOuterType: event.precedingOuterType,
            precedingSemanticType: event.precedingSemanticType,
            resetCauseCandidate: resetCauseCandidate(event),
            lastMatchesCurrent: currentEqualsLast,
            modelBefore: event.modelBefore,
            modelAfter: event.model,
            timeGapMs: event.timeGapMs,
            segmentIndex,
          });
          sessionSummary.resetCount += 1;
        } else if (duplicate) {
          repeatedTotalSnapshot += 1;
          if (last && tokenValue(last) > 0) {
            repeatedTotalWithNonZeroLast += 1;
            repeatedLastTokens += tokenValue(last);
          }
          delta = emptyRaw();
          hybrid = emptyRaw();
          eventClass = "duplicate-snapshot";
          sessionSummary.duplicateSnapshotCount += 1;
        } else {
          delta = positiveRawDelta(total, previous);
          hybrid =
            last && !previous ? copyRawCounters(last) : copyRawCounters(delta);
          eventClass = last
            ? tokenValue(last) === tokenValue(delta)
              ? "last-delta-match"
              : "last-delta-mismatch"
            : "normal-delta";
        }
        if (!previous && last) {
          const difference = tokenValue(total) - tokenValue(last);
          if (difference === 0) firstSnapshotTotalEqualsLast += 1;
          else if (difference > 0) firstSnapshotTotalGreaterThanLast += 1;
          firstSnapshotDifferenceTokens += Math.max(difference, 0);
        }
        previous = total;
        lastSeenTotal = copyRawCounters(total);
        addRaw(segmentedTotal, delta);
        event.segmentDelta = delta;
      } else if (last) {
        eventClass = "last-only";
        hybrid = copyRawCounters(last);
      } else if (event.flatUsage) {
        eventClass = "total-only";
        hybrid = copyRawCounters(event.flatUsage);
      } else {
        sourceCounts.zeroUsage += 1;
        continue;
      }
      const parserContribution = event.ignoredNoModel
        ? undefined
        : (last ?? delta ?? event.flatUsage);
      event.hybridContribution = hybrid;
      event.parserEquivalentContribution = parserContribution;
      event.eventClass = eventClass;
      eventClasses[eventClass] += 1;
      if (parserContribution)
        sourceCounts[sourceKey].parserEquivalentTokens +=
          tokenValue(parserContribution);
      if (hybrid) sourceCounts[sourceKey].hybridTokens += tokenValue(hybrid);
      if (last && delta) {
        const mismatch = Math.abs(tokenValue(last) - tokenValue(delta));
        mismatchBuckets[mismatchBucket(mismatch)] =
          (mismatchBuckets[mismatchBucket(mismatch)] ?? 0) + 1;
        if (mismatch > 0) lastVsDeltaMismatch += 1;
        absoluteMismatchTokens += mismatch;
        lastGreaterTokens += Math.max(tokenValue(last) - tokenValue(delta), 0);
        deltaGreaterTokens += Math.max(tokenValue(delta) - tokenValue(last), 0);
        positiveMismatchTokens += Math.max(
          tokenValue(last) - tokenValue(delta),
          0,
        );
      }
      if (last) addTokenUsage(lastSum, normalized(last));
      if (delta) addTokenUsage(deltaSum, normalized(delta));
      const currentContribution = last ?? delta ?? event.flatUsage;
      if (currentContribution)
        addTokenUsage(currentSum, normalized(currentContribution));
      if (parserContribution) {
        addTokenUsage(parserV4RawSum, normalized(parserContribution));
        if (event.stableId)
          parserMirror.set(event.stableId, normalized(parserContribution));
      }
      if (hybrid) addTokenUsage(hybridSum, normalized(hybrid));
      if (last) sessionSummary.lastUsageTokens += tokenValue(last);
      if (delta) sessionSummary.segmentedDeltaTokens += tokenValue(delta);
      if (parserContribution)
        sessionSummary.parserEquivalentV4Tokens +=
          tokenValue(parserContribution);
      if (hybrid) sessionSummary.hybridCanonicalTokens += tokenValue(hybrid);
      const pointDay = dayOf(event.timestamp);
      if (pointDay) {
        const point = dayMap.get(pointDay) ?? {
          day: pointDay,
          currentTotal: 0,
          currentEquivalentTotal: 0,
          lastUsageTotal: 0,
          totalDeltaTotal: 0,
          segmentedTotalDeltaTotal: 0,
          forkAwareTotal: 0,
          parserEquivalentV4Total: 0,
          hybridCanonicalTotal: 0,
        };
        const current = last ?? delta ?? event.flatUsage;
        point.currentTotal += tokenValue(current);
        point.currentEquivalentTotal += tokenValue(current);
        point.parserEquivalentV4Total += tokenValue(
          event.parserEquivalentContribution,
        );
        point.hybridCanonicalTotal += tokenValue(hybrid);
        point.lastUsageTotal += tokenValue(last);
        point.totalDeltaTotal += tokenValue(delta);
        point.segmentedTotalDeltaTotal += tokenValue(delta);
        dayMap.set(pointDay, point);
      }
    }
    const finalTotal = lastSeenTotal;
    if (finalTotal) {
      addTokenUsage(terminalSum, normalized(finalTotal));
      sessionSummary.terminalTokens = tokenValue(finalTotal);
    }
    sessions.set(key, {
      file,
      segmentedTotal,
      finalTotal: finalTotal ? copyRawCounters(finalTotal) : undefined,
    });
    rankings.push(sessionSummary);
  }
  const forks = canonical.filter((file) => !!file.forkedFromId);
  let baselineResolved = 0;
  let baselineMissing = 0;
  let childFirstLastResolved = 0;
  let parentAtForkResolved = 0;
  for (const file of canonical) {
    const accounting = sessions.get(file.sessionId ?? file.entry.path);
    if (!accounting) continue;
    let baseline: CodexRawCounters | undefined;
    if (file.forkedFromId) {
      const first = file.events.find((event) => event.usage);
      if (
        first?.usage &&
        first.lastUsage &&
        rawCounterTotal(first.usage) >= rawCounterTotal(first.lastUsage)
      ) {
        baseline = positiveRawDelta(first.usage, first.lastUsage);
        childFirstLastResolved += 1;
      } else {
        const parent = sessions.get(file.forkedFromId);
        baseline = parent
          ? parentBaselineAt(parent, file.sessionTimestamp ?? first?.timestamp)
          : undefined;
        if (baseline) parentAtForkResolved += 1;
      }
      if (baseline) baselineResolved += 1;
      else baselineMissing += 1;
      const firstToken = file.events.find((event) => event.segmentDelta);
      if (firstToken) {
        eventClasses["fork-first"] += 1;
        if (!baseline) eventClasses["fork-baseline-unresolved"] += 1;
      }
    }
    let firstDelta = true;
    let currentEquivalentAdjusted = false;
    for (const event of file.events) {
      if (!event.segmentDelta) continue;
      if (
        !currentEquivalentAdjusted &&
        file.forkedFromId &&
        event.usage &&
        event.lastUsage
      ) {
        const parent = sessions.get(file.forkedFromId);
        if (parent?.finalTotal) {
          const adjusted = positiveRawDelta(event.usage, parent.finalTotal);
          subtractTokenUsage(currentSum, normalized(event.lastUsage));
          addTokenUsage(currentSum, normalized(adjusted));
          if (event.parserEquivalentContribution) {
            subtractTokenUsage(
              parserV4RawSum,
              normalized(event.parserEquivalentContribution),
            );
            addTokenUsage(parserV4RawSum, normalized(adjusted));
            event.parserEquivalentContribution = adjusted;
            if (event.stableId)
              parserMirror.set(event.stableId, normalized(adjusted));
          }
        }
        currentEquivalentAdjusted = true;
      }
      const contribution =
        file.forkedFromId && firstDelta && baseline
          ? positiveRawDelta(event.segmentDelta, baseline)
          : copyRawCounters(event.segmentDelta);
      firstDelta = false;
      addTokenUsage(forkAwareSum, normalized(contribution));
      const pointDay = dayOf(event.timestamp);
      if (pointDay) {
        const point = dayMap.get(pointDay);
        if (point) point.forkAwareTotal += tokenValue(contribution);
      }
    }
  }
  const parserV4UniqueSum = zeroUsage();
  for (const usage of parserMirror.values())
    addTokenUsage(parserV4UniqueSum, usage);
  const lastMinusTotalDelta: TokenUsage = {
    inputTokens: lastSum.inputTokens - deltaSum.inputTokens,
    cachedInputTokens: lastSum.cachedInputTokens - deltaSum.cachedInputTokens,
    cacheCreationInputTokens:
      lastSum.cacheCreationInputTokens - deltaSum.cacheCreationInputTokens,
    outputTokens: lastSum.outputTokens - deltaSum.outputTokens,
    reasoningOutputTokens:
      lastSum.reasoningOutputTokens - deltaSum.reasoningOutputTokens,
  };
  const missingTimestamp =
    timestampSources.inherited +
    timestampSources.session +
    timestampSources.fileModified +
    timestampSources.unresolved;
  rankings.sort(
    (a, b) =>
      Math.abs(b.segmentedDeltaTokens - b.terminalTokens) -
      Math.abs(a.segmentedDeltaTokens - a.terminalTokens),
  );
  const largestSegmentTerminalDifference = rankings.slice(0, 20);
  const largestV4HybridDifference = [...rankings]
    .sort(
      (a, b) =>
        Math.abs(b.parserEquivalentV4Tokens - b.hybridCanonicalTokens) -
        Math.abs(a.parserEquivalentV4Tokens - a.hybridCanonicalTokens),
    )
    .slice(0, 20);
  const peakDays = [...dayMap.values()]
    .sort((a, b) => b.parserEquivalentV4Total - a.parserEquivalentV4Total)
    .slice(0, 20);
  return {
    auditVersion: 3,
    parserVersion: 4,
    accounting: "codex-accounting-audit-v3",
    generatedAt: Date.now(),
    files: files.length,
    canonicalFiles: canonical.length,
    duplicateFiles: files.length - canonical.length,
    sessions: canonical.length,
    events: {
      total: files.reduce((sum, file) => sum + file.totalEvents, 0),
      usageEvents,
      tokenCount,
      withLastUsage,
      withTotalUsage,
      withBoth,
      missingTimestamp,
      totalCounterDecrease,
      repeatedTotalSnapshot,
      repeatedTotalWithNonZeroLast,
      lastVsDeltaMismatch,
    },
    usageSources: sourceCounts,
    eventTaxonomy,
    eventClasses,
    mismatchBuckets,
    fork: {
      sessions: forks.length,
      baselineResolved,
      baselineMissing,
      childFirstLastResolved,
      parentAtForkResolved,
    },
    methods: {
      lastUsageSum: lastSum,
      segmentedTotalDelta: deltaSum,
      totalDeltaSum: deltaSum,
      currentEquivalent: currentSum,
      parserEquivalentV4AllEvents: parserV4RawSum,
      parserEquivalentV4Unique: parserV4UniqueSum,
      parserEquivalentV4UniqueRecordCount: parserMirror.size,
      sessionTerminalTotal: terminalSum,
      forkAwareTotalDelta: forkAwareSum,
      hybridCanonical: hybridSum,
    },
    discrepancy: {
      lastMinusTotalDelta,
      lastMinusTotalDeltaTotal: totalTokens(lastMinusTotalDelta),
      absoluteMismatchTokens,
      lastGreaterTokens,
      deltaGreaterTokens,
      repeatedLastTokens,
      positiveMismatchTokens,
    },
    reconciliation: {
      firstSnapshotTotalEqualsLast,
      firstSnapshotTotalGreaterThanLast,
      firstSnapshotDifferenceTokens,
      parserEquivalentV4MinusHybridTokens: usageDifference(
        parserV4RawSum,
        hybridSum,
      ),
      segmentedDeltaMinusHybridTokens: usageDifference(deltaSum, hybridSum),
      terminalMinusHybridTokens: usageDifference(terminalSum, hybridSum),
    },
    timestampSources,
    resets: {
      count: resetItems.length,
      items: resetItems.slice(0, 2000),
      byPreviousEventType: resetByType,
      currentEqualsLast: resetCurrentEqualsLast,
      currentDiffersFromLast: resetCurrentDiffersFromLast,
    },
    sessionRankings: {
      largestSegmentTerminalDifference,
      largestV4HybridDifference,
    },
    peakDays,
    anomalies: {
      repeatedTotalSnapshot,
      repeatedTotalWithNonZeroLast,
      totalCounterDecrease,
      componentCounterDecrease,
      lastVsDeltaMismatch,
      missingTimestamp,
    },
  };
}
