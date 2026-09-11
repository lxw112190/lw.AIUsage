import {
  addUsage,
  cachedInputShare,
  estimatedCostUsd,
  pricingForModel,
  totalTokens,
  zeroUsage,
  type AgentSource,
  type TokenUsage,
  type UsageRecord,
} from "@lw-aiusage/core";
import type { UsageQuery, UsageRepository } from "@lw-aiusage/storage";

export interface UsageSessionSummary {
  key: string;
  source: AgentSource;
  sessionId: string;
  startedAt: number;
  lastActiveAt: number;
  spanMs: number;
  primaryProjectKey: string;
  primaryModel: string;
  models: string[];
  projects: string[];
  recordCount: number;
  usage: TokenUsage;
  totalTokens: number;
  estimatedCostUsd: number;
  inputContextTokens: number;
  cachedInputShare?: number;
}

export interface SessionFilters {
  from?: number;
  to?: number;
  source?: AgentSource;
  model?: string;
  projectKey?: string;
}

export type SessionSort = "recent" | "tokens" | "span";

export interface SessionListQuery {
  filters: SessionFilters;
  page: number;
  pageSize: number;
  order: SessionSort;
}

export interface SessionListResult {
  items: UsageSessionSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  unassignedRecordCount: number;
  unassignedTokens: number;
}

export interface SessionTimelinePoint {
  start: number;
  usage: TokenUsage;
  totalTokens: number;
}

export interface SessionDetailData {
  summary: UsageSessionSummary;
  timeline: SessionTimelinePoint[];
  records: UsageRecord[];
}

interface SessionAccumulator {
  source: AgentSource;
  sessionId: string;
  startedAt: number;
  lastActiveAt: number;
  recordCount: number;
  usage: TokenUsage;
  estimatedCostUsd: number;
  models: Map<string, number>;
  projects: Map<string, number>;
}

const sessionKey = (record: UsageRecord): string => `${record.source}:${record.sessionId}`;

function summarize(accumulator: SessionAccumulator): UsageSessionSummary {
  const rank = (values: Map<string, number>): string[] => [...values.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key]) => key);
  const models = rank(accumulator.models);
  const projects = rank(accumulator.projects);
  const tokens = totalTokens(accumulator.usage);
  return {
    key: `${accumulator.source}:${accumulator.sessionId}`,
    source: accumulator.source,
    sessionId: accumulator.sessionId,
    startedAt: accumulator.startedAt,
    lastActiveAt: accumulator.lastActiveAt,
    spanMs: Math.max(0, accumulator.lastActiveAt - accumulator.startedAt),
    primaryProjectKey: projects[0] ?? "unknown",
    primaryModel: models[0] ?? "unknown",
    models,
    projects,
    recordCount: accumulator.recordCount,
    usage: accumulator.usage,
    totalTokens: tokens,
    estimatedCostUsd: accumulator.estimatedCostUsd,
    inputContextTokens: accumulator.usage.inputTokens + accumulator.usage.cachedInputTokens + accumulator.usage.cacheCreationInputTokens,
    ...(cachedInputShare(accumulator.usage) === undefined ? {} : { cachedInputShare: cachedInputShare(accumulator.usage) }),
  };
}

export function aggregateUsageSessions(records: readonly UsageRecord[]): {
  sessions: UsageSessionSummary[];
  unassigned: { recordCount: number; totalTokens: number };
} {
  const grouped = new Map<string, SessionAccumulator>();
  let unassignedRecordCount = 0;
  let unassignedTokens = 0;
  for (const record of records) {
    if (!record.sessionId) {
      unassignedRecordCount += 1;
      unassignedTokens += totalTokens(record.usage);
      continue;
    }
    const key = sessionKey(record);
    const tokens = totalTokens(record.usage);
    const current = grouped.get(key);
    if (current) {
      current.startedAt = Math.min(current.startedAt, record.timestamp);
      current.lastActiveAt = Math.max(current.lastActiveAt, record.timestamp);
      current.recordCount += 1;
      current.usage = addUsage(current.usage, record.usage);
      current.estimatedCostUsd += pricingForModel(record.model) ? estimatedCostUsd(record.usage, pricingForModel(record.model)!) : 0;
      current.models.set(record.model, (current.models.get(record.model) ?? 0) + tokens);
      current.projects.set(record.projectKey, (current.projects.get(record.projectKey) ?? 0) + tokens);
    } else {
      const models = new Map([[record.model, tokens]]);
      const projects = new Map([[record.projectKey, tokens]]);
      grouped.set(key, {
        source: record.source,
        sessionId: record.sessionId,
        startedAt: record.timestamp,
        lastActiveAt: record.timestamp,
        recordCount: 1,
        usage: addUsage(zeroUsage(), record.usage),
        estimatedCostUsd: pricingForModel(record.model) ? estimatedCostUsd(record.usage, pricingForModel(record.model)!) : 0,
        models,
        projects,
      });
    }
  }
  return {
    sessions: [...grouped.values()].map(summarize),
    unassigned: { recordCount: unassignedRecordCount, totalTokens: unassignedTokens },
  };
}

export class SessionUsageService {
  constructor(private readonly repository: UsageRepository) {}

  async list(query: SessionListQuery): Promise<SessionListResult> {
    const records = await this.repository.getRecords(query.filters);
    const grouped = aggregateUsageSessions(records);
    const items = grouped.sessions.sort((left, right) => {
      if (query.order === "tokens") return right.totalTokens - left.totalTokens || right.lastActiveAt - left.lastActiveAt;
      if (query.order === "span") return right.spanMs - left.spanMs || right.lastActiveAt - left.lastActiveAt;
      return right.lastActiveAt - left.lastActiveAt || right.totalTokens - left.totalTokens;
    });
    const pageSize = Math.max(1, Math.floor(query.pageSize));
    const requestedPage = Math.max(1, Math.floor(query.page));
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    const page = Math.min(requestedPage, totalPages);
    return {
      items: items.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: items.length,
      totalPages,
      unassignedRecordCount: grouped.unassigned.recordCount,
      unassignedTokens: grouped.unassigned.totalTokens,
    };
  }

  async detail(source: AgentSource, sessionId: string): Promise<SessionDetailData | undefined> {
    const records = await this.repository.getRecords({ source, sessionId });
    const summary = aggregateUsageSessions(records).sessions[0];
    if (!summary) return undefined;
    const timeline = new Map<number, TokenUsage>();
    for (const record of records) {
      const start = Math.floor(record.timestamp / 900_000) * 900_000;
      timeline.set(start, addUsage(timeline.get(start) ?? zeroUsage(), record.usage));
    }
    return {
      summary,
      records,
      timeline: [...timeline.entries()].sort((left, right) => left[0] - right[0]).map(([start, usage]) => ({ start, usage, totalTokens: totalTokens(usage) })),
    };
  }
}
