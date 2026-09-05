import { objectValue, stringValue } from "../shared/identity";
import type { UnknownCodexEvent } from "./types";
import type { CodexExtractedFile } from "./rawAuditTypes";

export interface CodexEventTypeInfo {
  outerType?: string;
  payloadType?: string;
  messageType?: string;
  semanticType?: string;
  isTokenCount: boolean;
}

export interface CodexEventTaxonomySummary {
  outerTypes: Record<string, number>;
  payloadTypes: Record<string, number>;
  messageTypes: Record<string, number>;
  semanticTypes: Record<string, number>;
  tokenCountEvents: number;
}

export function codexEventTypeInfo(event: UnknownCodexEvent): CodexEventTypeInfo {
  const payload = objectValue(event.payload);
  const msg = objectValue(payload?.msg);
  const outerType = stringValue(event.type);
  const payloadType = stringValue(payload?.type);
  const messageType = stringValue(msg?.type);
  const isTokenCount =
    outerType === "token_count" ||
    payloadType === "token_count" ||
    messageType === "token_count";
  const semanticType = isTokenCount
    ? "token_count"
    : outerType === "event_msg"
      ? payloadType ?? messageType ?? outerType
      : messageType ?? payloadType ?? outerType;
  return { outerType, payloadType, messageType, semanticType, isTokenCount };
}

export function emptyCodexEventTaxonomy(): CodexEventTaxonomySummary {
  return { outerTypes: {}, payloadTypes: {}, messageTypes: {}, semanticTypes: {}, tokenCountEvents: 0 };
}

export function addCodexEventTaxonomy(
  summary: CodexEventTaxonomySummary,
  info: CodexEventTypeInfo,
): void {
  const add = (target: Record<string, number>, value?: string): void => {
    if (value) target[value] = (target[value] ?? 0) + 1;
  };
  add(summary.outerTypes, info.outerType);
  add(summary.payloadTypes, info.payloadType);
  add(summary.messageTypes, info.messageType);
  add(summary.semanticTypes, info.semanticType);
  if (info.isTokenCount) summary.tokenCountEvents += 1;
}

export function summarizeCodexExtractedEvents(
  files: readonly CodexExtractedFile[],
): CodexEventTaxonomySummary {
  const summary = emptyCodexEventTaxonomy();
  for (const file of files) {
    for (const event of file.events) {
      addCodexEventTaxonomy(summary, {
        outerType: event.outerType,
        payloadType: event.payloadType,
        messageType: event.messageType,
        semanticType: event.semanticType,
        isTokenCount: event.isTokenCount ?? false,
      });
    }
  }
  return summary;
}
