import type { TokenUsage } from "@lw-aiusage/core";
import type { FileEntry } from "@lw-aiusage/platform";
import type { UnknownCodexEvent } from "./types";
import type { CodexRawCounters } from "./accounting";
import type { CodexEventTypeInfo } from "./eventTaxonomy";

export type CodexUsageSource =
  | "token-count"
  | "nested-info-non-token-count"
  | "payload-usage"
  | "flat-payload";

export interface CodexExtractedEvent {
  raw: UnknownCodexEvent;
  eventIndex: number;
  eventType?: string;
  explicitTimestamp?: number;
  previousEventType?: string;
  modelBefore?: string;
  resolvedModel?: string;
  resolvedSessionId?: string;
  forkedFromId?: string;
  total?: CodexRawCounters;
  last?: CodexRawCounters;
  flat?: CodexRawCounters;
  source?: CodexUsageSource;
  outerType?: string;
  payloadType?: string;
  messageType?: string;
  semanticType?: string;
  isTokenCount: boolean;
}

export interface CodexExtractedFile {
  entry: FileEntry;
  snapshotSize: number;
  peekLogicalId?: string;
  peekForkedFromId?: string;
  finalSessionId?: string;
  events: CodexExtractedEvent[];
}

export interface ParserV4MirrorRecord {
  id: string;
  sessionId?: string;
  timestamp: number;
  model: string;
  projectKey: string;
  sourceKind: CodexUsageSource;
  usage: TokenUsage;
}

export interface ParserV4MirrorSessionSummary {
  sessionId: string;
  recordCount: number;
  usage: TokenUsage;
}

export interface V4ForkTrace {
  childSessionId: string;
  parentSessionId: string;
  baselineUsed?: TokenUsage;
  firstUsageEventId?: string;
  firstTotal?: TokenUsage;
  firstLast?: TokenUsage;
  firstContribution?: TokenUsage;
}
