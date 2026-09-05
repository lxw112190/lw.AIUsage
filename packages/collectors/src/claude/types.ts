export interface UnknownClaudeEvent {
  type?: unknown;
  timestamp?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
  cwd?: unknown;
  uuid?: unknown;
  id?: unknown;
  message?: unknown;
  [key: string]: unknown;
}
import type { UsageParserState } from "@lw-aiusage/core";

export interface ClaudeParseContext extends UsageParserState {
  projectKey: string;
}
