import type { AgentSource } from "./models";

/** Stable logical identity for a session regardless of its current file path. */
export function logicalSessionKey(source: AgentSource, sessionId: string): string {
  return `${source}:${sessionId}`;
}
