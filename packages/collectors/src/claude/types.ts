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
import type { TokenUsage, UsageParserState } from "@lw-aiusage/core";

export interface ClaudeParserState extends UsageParserState {
  /** Latest usage per stable Claude message/request identity, bounded by the parser. */
  seenUsage?: Record<string, TokenUsage>;
}

export interface ClaudeParseContext extends ClaudeParserState {
  projectKey: string;
}
