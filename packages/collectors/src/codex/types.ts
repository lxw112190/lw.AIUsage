export interface UnknownCodexEvent {
  type?: unknown;
  timestamp?: unknown;
  payload?: unknown;
  [key: string]: unknown;
}
import type { TokenUsage, UsageParserState } from "@lw-aiusage/core";

export interface CodexParserState extends UsageParserState {
  forkedFromSessionId?: string;
  forkBaselineUsage?: TokenUsage;
  forkBaselineApplied?: boolean;
}

export interface CodexParseContext extends CodexParserState {
  projectKey: string;
}
