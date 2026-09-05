import { totalTokens, zeroUsage, type TokenUsage } from "@lw-aiusage/core";
import type { RuntimePlatform, FileEntry } from "@lw-aiusage/platform";
import { objectValue, stringValue } from "../shared/identity";
import { parseJsonl, readText } from "../shared/jsonl";
import type { UnknownCodexEvent } from "./types";

interface RawUsage {
  input: number;
  cachedInput: number;
  cacheCreationInput: number;
  output: number;
  reasoningOutput: number;
  total: number;
}
interface RawEvent {
  sessionId: string;
  forkedFromId?: string;
  usage?: RawUsage;
  lastUsage?: RawUsage;
  timestamp?: number;
  timestampSource: "explicit" | "inherited" | "session" | "file-modified" | "unresolved";
}
interface RawFile {
  entry: FileEntry;
  totalEvents: number;
  sessionId?: string;
  forkedFromId?: string;
  sessionTimestamp?: number;
  events: RawEvent[];
}
export interface CodexRawAuditDay {
  day: string;
  currentTotal: number;
  lastUsageTotal: number;
  totalDeltaTotal: number;
}
export interface CodexRawAuditAnomalySummary {
  repeatedTotalSnapshot: number;
  repeatedTotalWithNonZeroLast: number;
  totalCounterDecrease: number;
  lastVsDeltaMismatch: number;
  missingTimestamp: number;
}
export interface CodexRawAuditReport {
  generatedAt: number;
  files: number;
  canonicalFiles: number;
  duplicateFiles: number;
  sessions: number;
  events: {
    total: number;
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
  fork: {
    sessions: number;
    baselineResolved: number;
    baselineMissing: number;
  };
  methods: {
    lastUsageSum: TokenUsage;
    totalDeltaSum: TokenUsage;
    currentEquivalent: TokenUsage;
    sessionTerminalTotal: TokenUsage;
    forkAwareTotalDelta: TokenUsage;
  };
  discrepancy: {
    lastMinusTotalDelta: TokenUsage;
    lastMinusTotalDeltaTotal: number;
    repeatedLastTokens: number;
    positiveMismatchTokens: number;
  };
  timestampSources: {
    explicit: number;
    inherited: number;
    session: number;
    fileModified: number;
    unresolved: number;
  };
  peakDays: CodexRawAuditDay[];
  anomalies: CodexRawAuditAnomalySummary;
}

const CHUNK_BYTES = 1024 * 1024;
const isJsonl = (entry: FileEntry): boolean => entry.isFile && entry.name.toLowerCase().endsWith(".jsonl");
const isArchived = (path: string): boolean => /[\\/]archived_sessions[\\/]/i.test(path);
const emptyRaw = (): RawUsage => ({ input: 0, cachedInput: 0, cacheCreationInput: 0, output: 0, reasoningOutput: 0, total: 0 });
const hasRaw = (usage: RawUsage | undefined): usage is RawUsage => !!usage && (usage.input > 0 || usage.cachedInput > 0 || usage.cacheCreationInput > 0 || usage.output > 0 || usage.reasoningOutput > 0 || usage.total > 0);
const addRaw = (target: RawUsage, value: RawUsage): void => {
  target.input += value.input;
  target.cachedInput += value.cachedInput;
  target.cacheCreationInput += value.cacheCreationInput;
  target.output += value.output;
  target.reasoningOutput += value.reasoningOutput;
  target.total += value.total;
};
const subtractRaw = (current: RawUsage, previous?: RawUsage): RawUsage => {
  if (!previous) return { ...current };
  return {
    input: Math.max(current.input - previous.input, 0),
    cachedInput: Math.max(current.cachedInput - previous.cachedInput, 0),
    cacheCreationInput: Math.max(current.cacheCreationInput - previous.cacheCreationInput, 0),
    output: Math.max(current.output - previous.output, 0),
    reasoningOutput: Math.max(current.reasoningOutput - previous.reasoningOutput, 0),
    total: Math.max(current.total - previous.total, 0),
  };
};
const rawTotal = (usage: RawUsage): number => usage.total > 0 ? usage.total : usage.input + usage.output;
const normalized = (raw: RawUsage): TokenUsage => ({
  inputTokens: Math.max(raw.input - raw.cachedInput, 0),
  cachedInputTokens: raw.cachedInput,
  cacheCreationInputTokens: raw.cacheCreationInput,
  outputTokens: Math.max(raw.output - raw.reasoningOutput, 0),
  reasoningOutputTokens: raw.reasoningOutput,
});
const addTokenUsage = (target: TokenUsage, value: TokenUsage): void => {
  target.inputTokens += value.inputTokens;
  target.cachedInputTokens += value.cachedInputTokens;
  target.cacheCreationInputTokens += value.cacheCreationInputTokens;
  target.outputTokens += value.outputTokens;
  target.reasoningOutputTokens += value.reasoningOutputTokens;
};
const rawUsageOf = (value: unknown): RawUsage | undefined => {
  const object = objectValue(value);
  if (!object) return undefined;
  const number = (...keys: string[]): number => {
    for (const key of keys) {
      const candidate = object[key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    }
    return 0;
  };
  const result = {
    input: number("input_tokens", "inputTokens"),
    cachedInput: number("cached_input_tokens", "cachedInputTokens"),
    cacheCreationInput: number("cache_creation_input_tokens", "cacheCreationInputTokens", "cache_write_input_tokens"),
    output: number("output_tokens", "outputTokens"),
    reasoningOutput: number("reasoning_output_tokens", "reasoningOutputTokens"),
    total: number("total_tokens", "totalTokens"),
  };
  return hasRaw(result) ? result : undefined;
};
const tokenInfo = (event: UnknownCodexEvent): { last?: RawUsage; total?: RawUsage } => {
  const payload = objectValue(event.payload) ?? event;
  const msg = objectValue(payload.msg);
  const info = objectValue(payload.info) ?? objectValue(msg?.info) ?? objectValue(event.info);
  return {
    last: rawUsageOf(info?.last_token_usage ?? info?.lastTokenUsage),
    total: rawUsageOf(info?.total_token_usage ?? info?.totalTokenUsage),
  };
};
const timestampOf = (event: UnknownCodexEvent): number | undefined => {
  const values = [event.timestamp, objectValue(event.payload)?.timestamp, objectValue(objectValue(event.payload)?.msg)?.timestamp];
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
};
const sessionMeta = (event: UnknownCodexEvent): { id?: string; forkedFromId?: string; timestamp?: number } => {
  const payload = objectValue(event.payload) ?? event;
  return {
    id: stringValue(payload.id) ?? stringValue(payload.session_id) ?? stringValue(payload.sessionId),
    forkedFromId: stringValue(payload.forked_from_id) ?? stringValue(payload.forkedFromId),
    timestamp: timestampOf(event),
  };
};
async function recursiveJsonl(platform: RuntimePlatform, root: string): Promise<FileEntry[]> {
  if (!(await platform.fs.exists(root))) return [];
  const entries = await platform.fs.list(root);
  const files: FileEntry[] = [];
  for (const entry of entries) {
    if (isJsonl(entry)) files.push(entry);
    else if (entry.isDirectory) files.push(...(await recursiveJsonl(platform, entry.path)));
  }
  return files;
}
async function readFile(platform: RuntimePlatform, entry: FileEntry): Promise<RawFile> {
  const result: RawFile = { entry, totalEvents: 0, events: [] };
  let offset = 0;
  let pendingText = "";
  let inheritedTimestamp: number | undefined;
  while (offset < entry.size) {
    const end = Math.min(entry.size, offset + CHUNK_BYTES);
    const parsed = parseJsonl<UnknownCodexEvent>(readText(await platform.fs.readRange(entry.path, offset, end)), pendingText);
    pendingText = parsed.pendingText;
    for (const event of parsed.values) {
      result.totalEvents += 1;
      if (event.type === "session_meta") {
        const meta = sessionMeta(event);
        result.sessionId ??= meta.id;
        result.forkedFromId ??= meta.forkedFromId;
        result.sessionTimestamp ??= meta.timestamp;
      }
      const payload = objectValue(event.payload) ?? event;
      const msg = objectValue(payload.msg);
      const isTokenCount = event.type === "token_count" || payload.type === "token_count" || msg?.type === "token_count";
      if (!isTokenCount) continue;
      const info = tokenInfo(event);
      if (!info.last && !info.total) continue;
      const timestamp = timestampOf(event);
      const resolved = timestamp !== undefined ? "explicit" : inheritedTimestamp !== undefined ? "inherited" : result.sessionTimestamp !== undefined ? "session" : entry.modifiedAt ? "file-modified" : "unresolved";
      const value = timestamp ?? inheritedTimestamp ?? result.sessionTimestamp ?? (entry.modifiedAt || undefined);
      if (value !== undefined) inheritedTimestamp = value;
      result.events.push({ sessionId: result.sessionId ?? `file:${entry.path}`, forkedFromId: result.forkedFromId, usage: info.total, lastUsage: info.last, timestamp: value, timestampSource: resolved });
    }
    offset = end;
  }
  if (pendingText.trim()) {
    const parsed = parseJsonl<UnknownCodexEvent>(`${pendingText}\n`, "");
    for (const event of parsed.values) {
      result.totalEvents += 1;
      const payload = objectValue(event.payload) ?? event;
      const msg = objectValue(payload.msg);
      if (event.type !== "token_count" && payload.type !== "token_count" && msg?.type !== "token_count") continue;
      const info = tokenInfo(event);
      if (info.last || info.total) result.events.push({ sessionId: result.sessionId ?? `file:${entry.path}`, forkedFromId: result.forkedFromId, usage: info.total, lastUsage: info.last, timestamp: timestampOf(event) ?? result.sessionTimestamp ?? (entry.modifiedAt || undefined), timestampSource: timestampOf(event) !== undefined ? "explicit" : result.sessionTimestamp !== undefined ? "session" : entry.modifiedAt ? "file-modified" : "unresolved" });
    }
  }
  for (const event of result.events) event.sessionId = result.sessionId ?? event.sessionId;
  return result;
}
function preferredFile(left: RawFile, right: RawFile): RawFile {
  if (left.entry.size !== right.entry.size) return left.entry.size > right.entry.size ? left : right;
  if (left.entry.modifiedAt !== right.entry.modifiedAt) return left.entry.modifiedAt > right.entry.modifiedAt ? left : right;
  if (isArchived(left.entry.path) !== isArchived(right.entry.path)) return isArchived(left.entry.path) ? left : right;
  return left.entry.path.localeCompare(right.entry.path) <= 0 ? left : right;
}
function dayOf(timestamp: number | undefined): string | undefined {
  if (timestamp === undefined) return undefined;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function auditCodexRaw(platform: RuntimePlatform, onProgress?: (current: number, total: number) => void): Promise<CodexRawAuditReport> {
  const home = await platform.paths.home();
  const roots = [`${home}/.codex/sessions`, `${home}/.codex/archived_sessions`];
  const entries = (await Promise.all(roots.map((root) => recursiveJsonl(platform, root)))).flat();
  const files: RawFile[] = [];
  for (const [index, entry] of entries.entries()) {
    files.push(await readFile(platform, entry));
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
  const usage = zeroUsage();
  const lastSum = zeroUsage();
  const deltaSum = zeroUsage();
  const currentSum = zeroUsage();
  const terminalSum = zeroUsage();
  const forkAwareSum = zeroUsage();
  const timestampSources = { explicit: 0, inherited: 0, session: 0, fileModified: 0, unresolved: 0 };
  const dayMap = new Map<string, CodexRawAuditDay>();
  let tokenCount = 0;
  let withLastUsage = 0;
  let withTotalUsage = 0;
  let withBoth = 0;
  let totalCounterDecrease = 0;
  let repeatedTotalSnapshot = 0;
  let repeatedTotalWithNonZeroLast = 0;
  let lastVsDeltaMismatch = 0;
  let repeatedLastTokens = 0;
  let positiveMismatchTokens = 0;
  let missingTimestamp = 0;
  const terminals = new Map<string, TokenUsage>();
  const forks = canonical.filter((file) => !!file.forkedFromId);
  let baselineResolved = 0;
  for (const file of canonical) {
    let previous: RawUsage | undefined;
    for (const event of file.events) {
      tokenCount += 1;
      if (event.lastUsage) withLastUsage += 1;
      if (event.usage) withTotalUsage += 1;
      if (event.lastUsage && event.usage) withBoth += 1;
      timestampSources[event.timestampSource === "file-modified" ? "fileModified" : event.timestampSource] += 1;
      if (event.timestampSource !== "explicit") missingTimestamp += 1;
      const last = event.lastUsage;
      const total = event.usage;
      let deltaPrevious = previous;
      if (total && previous) {
        const currentTotal = rawTotal(total);
        const previousTotal = rawTotal(previous);
        if (currentTotal < previousTotal) { totalCounterDecrease += 1; deltaPrevious = undefined; }
        else {
          if (currentTotal === previousTotal) { repeatedTotalSnapshot += 1; if (last && rawTotal(last) > 0) { repeatedTotalWithNonZeroLast += 1; repeatedLastTokens += rawTotal(last); } }
          const effectiveDelta = subtractRaw(total, previous);
          if (last && rawTotal(last) !== rawTotal(effectiveDelta)) { lastVsDeltaMismatch += 1; positiveMismatchTokens += Math.max(rawTotal(last) - rawTotal(effectiveDelta), 0); }
        }
      }
      const delta = total ? subtractRaw(total, deltaPrevious) : undefined;
      if (last) addTokenUsage(lastSum, normalized(last));
      if (delta) addTokenUsage(deltaSum, normalized(delta));
      const current = last ?? delta;
      if (current) addTokenUsage(currentSum, normalized(current));
      const pointDay = dayOf(event.timestamp);
      if (pointDay) {
        const point = dayMap.get(pointDay) ?? { day: pointDay, currentTotal: 0, lastUsageTotal: 0, totalDeltaTotal: 0 };
        point.currentTotal += current ? totalTokens(normalized(current)) : 0;
        point.lastUsageTotal += last ? totalTokens(normalized(last)) : 0;
        point.totalDeltaTotal += delta ? totalTokens(normalized(delta)) : 0;
        dayMap.set(pointDay, point);
      }
      if (total) previous = total;
    }
    if (file.events.length) {
      const final = file.events.at(-1)?.usage;
      if (final) {
        const finalUsage = normalized(final);
        terminals.set(file.sessionId ?? file.entry.path, finalUsage);
        addTokenUsage(terminalSum, finalUsage);
      }
    }
  }
  for (const file of forks) {
    const child = terminals.get(file.sessionId ?? file.entry.path);
    const parent = file.forkedFromId ? terminals.get(file.forkedFromId) : undefined;
    if (child && parent) { baselineResolved += 1; addTokenUsage(forkAwareSum, { inputTokens: Math.max(child.inputTokens - parent.inputTokens, 0), cachedInputTokens: Math.max(child.cachedInputTokens - parent.cachedInputTokens, 0), cacheCreationInputTokens: Math.max(child.cacheCreationInputTokens - parent.cacheCreationInputTokens, 0), outputTokens: Math.max(child.outputTokens - parent.outputTokens, 0), reasoningOutputTokens: Math.max(child.reasoningOutputTokens - parent.reasoningOutputTokens, 0) }); }
    else if (child) addTokenUsage(forkAwareSum, child);
  }
  for (const file of canonical.filter((item) => !item.forkedFromId)) {
    const terminal = terminals.get(file.sessionId ?? file.entry.path);
    if (terminal) addTokenUsage(forkAwareSum, terminal);
  }
  const lastMinusTotalDelta: TokenUsage = { inputTokens: lastSum.inputTokens - deltaSum.inputTokens, cachedInputTokens: lastSum.cachedInputTokens - deltaSum.cachedInputTokens, cacheCreationInputTokens: lastSum.cacheCreationInputTokens - deltaSum.cacheCreationInputTokens, outputTokens: lastSum.outputTokens - deltaSum.outputTokens, reasoningOutputTokens: lastSum.reasoningOutputTokens - deltaSum.reasoningOutputTokens };
  const days = [...dayMap.values()];
  return {
    generatedAt: Date.now(), files: files.length, canonicalFiles: canonical.length, duplicateFiles: files.length - canonical.length, sessions: canonical.length,
    events: { total: files.reduce((sum, file) => sum + file.totalEvents, 0), tokenCount, withLastUsage, withTotalUsage, withBoth, missingTimestamp, totalCounterDecrease, repeatedTotalSnapshot, repeatedTotalWithNonZeroLast, lastVsDeltaMismatch },
    fork: { sessions: forks.length, baselineResolved, baselineMissing: forks.length - baselineResolved },
    methods: { lastUsageSum: lastSum, totalDeltaSum: deltaSum, currentEquivalent: currentSum, sessionTerminalTotal: terminalSum, forkAwareTotalDelta: forkAwareSum },
    discrepancy: { lastMinusTotalDelta, lastMinusTotalDeltaTotal: totalTokens(lastMinusTotalDelta), repeatedLastTokens, positiveMismatchTokens },
    timestampSources, peakDays: [...days].sort((left, right) => right.currentTotal - left.currentTotal).slice(0, 20),
    anomalies: { repeatedTotalSnapshot, repeatedTotalWithNonZeroLast, totalCounterDecrease, lastVsDeltaMismatch, missingTimestamp },
  };
}
