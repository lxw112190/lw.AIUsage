export interface UnknownCodexEvent {
  type?: unknown;
  timestamp?: unknown;
  payload?: unknown;
  [key: string]: unknown;
}
import type { UsageParserState } from "@lw-aiusage/core";

export interface CodexParseContext extends UsageParserState {
  projectKey: string;
}
