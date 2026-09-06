import { objectValue, stableHash, stringValue } from "../shared/identity";
import { codexEventTypeInfo } from "./eventTaxonomy";
import {
  decodeRawTokenUsage,
  type CodexAccountingEvent,
} from "./accountingV5";
import type { UnknownCodexEvent } from "./types";

export interface CodexParsedFileInputV5 {
  sourcePath: string;
  logicalIdHint?: string;
  values: readonly UnknownCodexEvent[];
  parseErrors?: readonly string[];
  hasPendingText?: boolean;
}

export interface CodexV5DecodeDiagnostics {
  tokenCountEvents: number;
  payloadUsageEvents: number;
  legacyFlatUsageEvents: number;
  nestedUsageOnNonTokenEvents: number;
  missingTimestampEvents: number;
  sessionMetaEvents: number;
  sessionIdentityConflicts: number;
  parentIdentityConflicts: number;
}

export interface CodexDecodedFileV5 {
  sourcePath: string;
  logicalIdHint?: string;
  sessionId?: string;
  parentSessionId?: string;
  forkTimestamp?: number;
  events: CodexAccountingEvent[];
  rawEventCount: number;
  parseErrors: string[];
  hasPendingText: boolean;
  diagnostics: CodexV5DecodeDiagnostics;
}

interface CodexDecodeContextV5 {
  sessionId?: string;
  parentSessionId?: string;
  currentModel?: string;
  projectKey?: string;
  forkTimestamp?: number;
}

const firstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    const result = stringValue(value);
    if (result) return result;
  }
  return undefined;
};

const nestedString = (object: Record<string, unknown> | undefined, ...keys: string[]): string | undefined =>
  firstString(...keys.map((key) => object?.[key]));

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, stableJsonValue(object[key])]));
}

const stableJsonStringify = (value: unknown): string => JSON.stringify(stableJsonValue(value));

export function codexTimestampV5(event: UnknownCodexEvent): number | undefined {
  const payload = objectValue(event.payload);
  const msg = objectValue(payload?.msg);
  for (const value of [event.timestamp, payload?.timestamp, msg?.timestamp]) {
    if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

const protocolParts = (event: UnknownCodexEvent): {
  payload: Record<string, unknown>;
  msg?: Record<string, unknown>;
  info?: Record<string, unknown>;
} => {
  const payload = objectValue(event.payload) ?? event;
  const msg = objectValue(payload.msg);
  return { payload, msg, info: objectValue(payload.info) ?? objectValue(msg?.info) ?? objectValue(event.info) };
};

const sessionIdOf = (
  event: UnknownCodexEvent,
  payload: Record<string, unknown>,
  msg: Record<string, unknown> | undefined,
  current?: string,
): string | undefined => {
  const outerType = stringValue(event.type);
  return firstString(
    outerType === "session_meta" ? payload.id : undefined,
    payload.session_id,
    payload.sessionId,
    msg?.session_id,
    msg?.sessionId,
    event.session_id,
    event.sessionId,
    current,
  );
};

const parentSessionIdOf = (
  payload: Record<string, unknown>,
  msg: Record<string, unknown> | undefined,
  event: UnknownCodexEvent,
  current?: string,
): string | undefined => firstString(
  payload.forked_from_id,
  payload.forkedFromId,
  msg?.forked_from_id,
  msg?.forkedFromId,
  event.forked_from_id,
  event.forkedFromId,
  current,
);

const modelOf = (
  event: UnknownCodexEvent,
  payload: Record<string, unknown>,
  msg: Record<string, unknown> | undefined,
  info: Record<string, unknown> | undefined,
  current?: string,
): string | undefined => firstString(payload.model, info?.model, msg?.model, event.model, current);

const projectOf = (
  event: UnknownCodexEvent,
  payload: Record<string, unknown>,
  msg: Record<string, unknown> | undefined,
  current?: string,
): string | undefined => firstString(payload.cwd, payload.project, msg?.cwd, event.cwd, current);

export function responseIdOf(event: UnknownCodexEvent): string | undefined {
  const { payload, msg } = protocolParts(event);
  return firstString(payload.response_id, payload.responseId, msg?.response_id, msg?.responseId, event.response_id, event.responseId);
}

export function turnIdOf(event: UnknownCodexEvent): string | undefined {
  const { payload, msg } = protocolParts(event);
  return firstString(payload.turn_id, payload.turnId, msg?.turn_id, msg?.turnId, event.turn_id, event.turnId);
}

const decodedUsageOf = (...values: unknown[]) => {
  for (const value of values) {
    const decoded = decodeRawTokenUsage(value);
    if (decoded) return decoded;
  }
  return undefined;
};

const eventRawIdentity = (event: UnknownCodexEvent, eventIndex: number): string =>
  `e${eventIndex}:h${stableHash(stableJsonStringify(event))}`;

const emptyDiagnostics = (): CodexV5DecodeDiagnostics => ({
  tokenCountEvents: 0,
  payloadUsageEvents: 0,
  legacyFlatUsageEvents: 0,
  nestedUsageOnNonTokenEvents: 0,
  missingTimestampEvents: 0,
  sessionMetaEvents: 0,
  sessionIdentityConflicts: 0,
  parentIdentityConflicts: 0,
});

export function decodeCodexFileV5(input: CodexParsedFileInputV5): CodexDecodedFileV5 {
  const diagnostics = emptyDiagnostics();
  const events: CodexAccountingEvent[] = [];
  const context: CodexDecodeContextV5 = {};
  let fileSessionId = input.logicalIdHint;
  let firstSessionMetaId: string | undefined;
  let fileParentSessionId: string | undefined;
  const replayedAncestorSessionIds = new Set<string>();
  let forkTimestamp: number | undefined;
  for (const [eventIndex, rawEvent] of input.values.entries()) {
    const taxonomy = codexEventTypeInfo(rawEvent);
    const { payload, msg, info } = protocolParts(rawEvent);
    const timestamp = codexTimestampV5(rawEvent);
    if (timestamp === undefined) diagnostics.missingTimestampEvents += 1;
    const sessionId = sessionIdOf(rawEvent, payload, msg, context.sessionId ?? fileSessionId);
    const parentSessionId = parentSessionIdOf(payload, msg, rawEvent, context.parentSessionId ?? fileParentSessionId);
    const model = modelOf(rawEvent, payload, msg, info, context.currentModel);
    const projectKey = projectOf(rawEvent, payload, msg, context.projectKey);
    const tokenLast = decodedUsageOf(info?.last_token_usage, info?.lastTokenUsage);
    const tokenTotal = decodedUsageOf(info?.total_token_usage, info?.totalTokenUsage);
    const tokenCount = taxonomy.isTokenCount && (tokenLast || tokenTotal)
      ? { last: tokenLast, total: tokenTotal }
      : undefined;
    const payloadUsage = decodeRawTokenUsage(payload.usage);
    let resolvedPayloadUsage = payloadUsage;
    if (resolvedPayloadUsage) diagnostics.payloadUsageEvents += 1;
    if (!taxonomy.isTokenCount && (tokenLast || tokenTotal)) diagnostics.nestedUsageOnNonTokenEvents += 1;
    if (!resolvedPayloadUsage && !taxonomy.isTokenCount) {
      const flat = decodeRawTokenUsage(payload);
      if (flat) {
        resolvedPayloadUsage = flat;
        diagnostics.legacyFlatUsageEvents += 1;
        diagnostics.payloadUsageEvents += 1;
      }
    }
    if (taxonomy.isTokenCount) diagnostics.tokenCountEvents += 1;
    const eventType = stringValue(rawEvent.type);
    if (eventType === "session_meta") {
      diagnostics.sessionMetaEvents += 1;
      const isKnownParentReplay = !!firstSessionMetaId && !!sessionId && sessionId !== firstSessionMetaId && replayedAncestorSessionIds.has(sessionId);
      const isPrimarySessionMeta = !firstSessionMetaId && !!sessionId;
      if (isPrimarySessionMeta) {
        if (fileSessionId && fileSessionId !== sessionId) diagnostics.sessionIdentityConflicts += 1;
        firstSessionMetaId = sessionId;
        fileSessionId = sessionId;
        fileParentSessionId = parentSessionId ?? fileParentSessionId;
        if (fileParentSessionId) replayedAncestorSessionIds.add(fileParentSessionId);
        if (fileParentSessionId && timestamp !== undefined) forkTimestamp = forkTimestamp ?? timestamp;
      } else if (!isKnownParentReplay) {
        if (firstSessionMetaId && sessionId && firstSessionMetaId !== sessionId) diagnostics.sessionIdentityConflicts += 1;
        if (fileParentSessionId && parentSessionId && fileParentSessionId !== parentSessionId) diagnostics.parentIdentityConflicts += 1;
        fileParentSessionId = parentSessionId ?? fileParentSessionId;
        if (parentSessionId) replayedAncestorSessionIds.add(parentSessionId);
        if (fileParentSessionId && timestamp !== undefined) forkTimestamp = forkTimestamp ?? timestamp;
      } else if (parentSessionId) {
        replayedAncestorSessionIds.add(parentSessionId);
      }
      if (!isKnownParentReplay) {
        context.sessionId = sessionId ?? context.sessionId;
        context.parentSessionId = parentSessionId ?? context.parentSessionId;
      }
    }
    if (eventType !== "session_meta") {
      context.sessionId = sessionId ?? context.sessionId;
      context.parentSessionId = parentSessionId ?? context.parentSessionId;
    }
    context.currentModel = model ?? context.currentModel;
    context.projectKey = projectKey ?? context.projectKey;
    const decoded: CodexAccountingEvent = {
      sourcePath: input.sourcePath,
      eventIndex,
      sessionId,
      parentSessionId,
      timestamp,
      model,
      projectKey,
      responseId: responseIdOf(rawEvent),
      turnId: turnIdOf(rawEvent),
      semanticType: taxonomy.semanticType,
      tokenCount,
      payloadUsage: resolvedPayloadUsage,
      rawIdentity: eventRawIdentity(rawEvent, eventIndex),
    };
    events.push(decoded);
  }
  const finalSessionId = fileSessionId ?? context.sessionId;
  const finalParentSessionId = fileParentSessionId ?? context.parentSessionId;
  const completedEvents = events.map((event) => ({
    ...event,
    sessionId: finalSessionId ?? event.sessionId,
    parentSessionId: finalParentSessionId ?? event.parentSessionId,
  }));
  return {
    sourcePath: input.sourcePath,
    logicalIdHint: input.logicalIdHint,
    sessionId: finalSessionId,
    parentSessionId: finalParentSessionId,
    forkTimestamp,
    events: completedEvents,
    rawEventCount: input.values.length,
    parseErrors: [...(input.parseErrors ?? [])],
    hasPendingText: input.hasPendingText ?? false,
    diagnostics,
  };
}

export const stableCodexEventJsonV5 = stableJsonStringify;
