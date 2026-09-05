import type { RuntimePlatform, FileEntry } from "@lw-aiusage/platform";
import { objectValue, stableHash, stringValue } from "../shared/identity";
import { parseJsonl, readText } from "../shared/jsonl";
import { rawCountersFrom, type CodexRawCounters } from "./accounting";
import type { UnknownCodexEvent } from "./types";
import type { CodexExtractedEvent, CodexExtractedFile } from "./rawAuditTypes";
import type { CodexUsageSource } from "./rawAuditTypes";
import { codexEventTypeInfo, type CodexEventTypeInfo } from "./eventTaxonomy";

export const CODEX_META_PEEK_BYTES = 64 * 1024;
export const CODEX_AUDIT_CHUNK_BYTES = 1024 * 1024;

export interface CodexSourceSnapshotFile {
  path: string;
  logicalId?: string;
  pathHash: string;
  size: number;
  modifiedAt: number;
}

export interface CodexSourceSnapshot {
  files: CodexSourceSnapshotFile[];
  fingerprint: string;
}

const usageFields = ["input_tokens", "inputTokens", "cached_input_tokens", "cachedInputTokens", "cache_creation_input_tokens", "cacheCreationInputTokens", "cache_write_input_tokens", "output_tokens", "outputTokens", "total_tokens", "totalTokens", "reasoning_output_tokens", "reasoningOutputTokens"];
const hasUsageFields = (value: unknown): boolean => { const object = objectValue(value); return !!object && usageFields.some((key) => key in object); };
const outerEventTypeOf = (event: UnknownCodexEvent): string | undefined => stringValue(event.type);
const semanticEventTypeOf = (event: UnknownCodexEvent): string | undefined => codexEventTypeInfo(event).semanticType;
const timestampOf = (event: UnknownCodexEvent): number | undefined => { const payload = objectValue(event.payload); const msg = objectValue(payload?.msg); for (const value of [event.timestamp, payload?.timestamp, msg?.timestamp]) { if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value; if (typeof value === "string") { const parsed = Date.parse(value); if (Number.isFinite(parsed)) return parsed; } } return undefined; };
const modelOf = (event: UnknownCodexEvent, current?: string): string | undefined => { const payload = objectValue(event.payload) ?? event; const msg = objectValue(payload.msg); const info = objectValue(payload.info) ?? objectValue(msg?.info) ?? objectValue(event.info); return stringValue(payload.model) ?? stringValue(info?.model) ?? stringValue(msg?.model) ?? stringValue(event.model) ?? current; };
const sessionOf = (event: UnknownCodexEvent, current?: string): string | undefined => { const payload = objectValue(event.payload) ?? event; const msg = objectValue(payload.msg); const type = outerEventTypeOf(event); return (type === "session_meta" ? stringValue(payload.id) : undefined) ?? stringValue(payload.session_id) ?? stringValue(payload.sessionId) ?? stringValue(msg?.session_id) ?? stringValue(msg?.sessionId) ?? stringValue(event.session_id) ?? stringValue(event.sessionId) ?? current; };
const forkOf = (event: UnknownCodexEvent): string | undefined => { const payload = objectValue(event.payload) ?? event; const msg = objectValue(payload.msg); return stringValue(payload.forked_from_id) ?? stringValue(payload.forkedFromId) ?? stringValue(msg?.forked_from_id) ?? stringValue(msg?.forkedFromId); };
const sourceOf = (event: UnknownCodexEvent, taxonomy = codexEventTypeInfo(event)): { source?: CodexUsageSource; total?: CodexRawCounters; last?: CodexRawCounters; flat?: CodexRawCounters } => { const payload = objectValue(event.payload) ?? event; const msg = objectValue(payload.msg); const info = objectValue(payload.info) ?? objectValue(msg?.info) ?? objectValue(event.info); const last = rawCountersFrom(info?.last_token_usage ?? info?.lastTokenUsage); const total = rawCountersFrom(info?.total_token_usage ?? info?.totalTokenUsage); if (taxonomy.isTokenCount) return { source: "token-count", total, last }; if (last || total) return { source: "nested-info-non-token-count", total, last }; const payloadUsage = rawCountersFrom(payload.usage); if (payloadUsage && hasUsageFields(payload.usage)) return { source: "payload-usage", flat: payloadUsage }; const flat = hasUsageFields(payload) ? rawCountersFrom(payload) : undefined; return flat ? { source: "flat-payload", flat } : {}; };

export async function peekCodexSessionMeta(platform: RuntimePlatform, entry: FileEntry): Promise<{ sessionId?: string; forkedFromId?: string }> {
  if (entry.size <= 0) return {};
  const bytes = await platform.fs.readRange(entry.path, 0, Math.min(entry.size, CODEX_META_PEEK_BYTES));
  const parsed = parseJsonl<UnknownCodexEvent>(readText(bytes), "");
  for (const event of parsed.values) if (outerEventTypeOf(event) === "session_meta") return { sessionId: sessionOf(event), forkedFromId: forkOf(event) };
  return {};
}

export async function extractCodexFile(platform: RuntimePlatform, entry: FileEntry, snapshotSize = entry.size, collectorLogicalId?: string): Promise<CodexExtractedFile> {
  const peek = await peekCodexSessionMeta(platform, { ...entry, size: Math.min(snapshotSize, CODEX_META_PEEK_BYTES) });
  const result: CodexExtractedFile = { entry, snapshotSize, peekLogicalId: collectorLogicalId ?? peek.sessionId, peekForkedFromId: peek.forkedFromId, events: [] };
  let offset = 0; let pendingText = ""; let eventIndex = 0; let currentModel: string | undefined; let currentSession: string | undefined; let previousEventType: string | undefined; const decoder = new TextDecoder();
  const consume = (event: UnknownCodexEvent): void => { const taxonomy: CodexEventTypeInfo = codexEventTypeInfo(event); const source = sourceOf(event, taxonomy); const type = outerEventTypeOf(event); const semanticType = semanticEventTypeOf(event); const modelBefore = currentModel; const model = modelOf(event, currentModel); const session = sessionOf(event, currentSession); const explicitTimestamp = timestampOf(event); const forkedFromId = forkOf(event); if (model) currentModel = model; if (session) currentSession = session; if (type === "session_meta") { result.finalSessionId ??= session; result.peekForkedFromId ??= forkedFromId; } result.events.push({ raw: event, eventIndex, eventType: type, explicitTimestamp, previousEventType, modelBefore, resolvedModel: model, resolvedSessionId: session, forkedFromId: forkedFromId ?? result.peekForkedFromId, total: source.total, last: source.last, flat: source.flat, source: source.source, outerType: taxonomy.outerType, payloadType: taxonomy.payloadType, messageType: taxonomy.messageType, semanticType, isTokenCount: taxonomy.isTokenCount }); eventIndex += 1; previousEventType = type ?? previousEventType; };
  const consumeText = (text: string): void => { const parsed = parseJsonl<UnknownCodexEvent>(text, pendingText); pendingText = parsed.pendingText; for (const event of parsed.values) consume(event); };
  while (offset < snapshotSize) { const end = Math.min(snapshotSize, offset + CODEX_AUDIT_CHUNK_BYTES); const bytes = await platform.fs.readRange(entry.path, offset, end); consumeText(decoder.decode(new Uint8Array(bytes), { stream: true })); offset = end; }
  const tail = decoder.decode(); if (tail) consumeText(tail); if (pendingText.trim()) consumeText("\n"); result.finalSessionId = result.finalSessionId ?? currentSession; return result;
}

export async function extractCodexFiles(platform: RuntimePlatform, entries: readonly FileEntry[], snapshot?: { files: Array<{ path: string; size: number; logicalId?: string }> }, onProgress?: (current: number, total: number) => void): Promise<CodexExtractedFile[]> {
  const files: CodexExtractedFile[] = []; for (const [index, entry] of entries.entries()) { const snapshotFile = snapshot?.files.find((file) => file.path === entry.path); const limit = snapshotFile?.size ?? entry.size; files.push(await extractCodexFile(platform, entry, limit, snapshotFile?.logicalId)); onProgress?.(index + 1, entries.length); } return files;
}

export async function snapshotCodexSource(platform: RuntimePlatform): Promise<CodexSourceSnapshot> {
  const home = await platform.paths.home(); const roots = [`${home}/.codex/sessions`, `${home}/.codex/archived_sessions`]; const entries: FileEntry[] = [];
  async function walk(root: string): Promise<void> { if (!(await platform.fs.exists(root))) return; for (const entry of await platform.fs.list(root)) if (entry.isFile && entry.name.toLowerCase().endsWith(".jsonl")) entries.push(entry); else if (entry.isDirectory) await walk(entry.path); }
  for (const root of roots) await walk(root);
  const files = []; for (const entry of entries) { const meta = await peekCodexSessionMeta(platform, entry); files.push({ path: entry.path, logicalId: meta.sessionId, pathHash: stableHash(entry.path), size: entry.size, modifiedAt: entry.modifiedAt }); }
  files.sort((left, right) => left.pathHash.localeCompare(right.pathHash) || left.path.localeCompare(right.path)); return { files, fingerprint: stableHash(JSON.stringify(files.map(({ path: _path, ...file }) => file))) };
}

export const snapshotCodexFiles = snapshotCodexSource;
