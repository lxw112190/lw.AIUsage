export type AgentSource = "codex" | "claude";

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface UsageRecord {
  id: string;
  source: AgentSource;
  sessionId?: string;
  timestamp: number;
  model: string;
  rawModel?: string;
  projectKey: string;
  usage: TokenUsage;
  reportedCostUsd?: number;
}

export interface UsageBucket {
  id: string;
  bucketStart: number;
  source: AgentSource;
  model: string;
  projectKey: string;
  usage: TokenUsage;
  recordCount: number;
  sessionCount: number;
}

export interface SessionRecord {
  id: string;
  source: AgentSource;
  startedAt: number;
  lastActiveAt: number;
  projectKey: string;
  model?: string;
}

export interface ProjectRecord {
  key: string;
  name: string;
  path?: string;
  repositoryUrl?: string;
  lastActiveAt: number;
}

export const zeroUsage = (): TokenUsage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
});

export const addUsage = (left: TokenUsage, right: TokenUsage): TokenUsage => ({
  inputTokens: left.inputTokens + right.inputTokens,
  cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
  cacheCreationInputTokens: left.cacheCreationInputTokens + right.cacheCreationInputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
});

export const totalTokens = (usage: TokenUsage): number =>
  usage.inputTokens +
  usage.cachedInputTokens +
  usage.cacheCreationInputTokens +
  usage.outputTokens +
  usage.reasoningOutputTokens;

export const projectDisplayName = (projectKey: string): string => {
  const normalized = projectKey.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) || "Unknown project";
};
