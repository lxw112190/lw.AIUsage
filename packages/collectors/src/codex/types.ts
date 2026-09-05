export interface UnknownCodexEvent { type?: unknown; timestamp?: unknown; payload?: unknown; [key: string]: unknown; }
export interface CodexParseContext { sessionId?: string; projectKey: string; currentModel?: string; previousTotals?: Record<string, number>; }
