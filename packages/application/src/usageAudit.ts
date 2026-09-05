import {
  tokenMetricSet,
  type AgentSource,
  type TokenUsage,
  type UsageRecord,
} from "@lw-aiusage/core";
import type { UsageRepository } from "@lw-aiusage/storage";

export interface TokenBreakdown {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}
export interface TokenTotals {
  currentTotal: number;
  withoutCached: number;
  withoutCacheCreation: number;
  withoutReasoning: number;
  withoutAllCache: number;
  plainInputOutput: number;
  rawIoEquivalent: number;
}
export interface UsageAuditDay {
  day: string;
  usage: TokenBreakdown;
  totals: TokenTotals;
}
export interface UsageAuditSource {
  source: AgentSource;
  recordCount: number;
  sessionCount: number;
  firstTimestamp?: number;
  lastTimestamp?: number;
  usage: TokenBreakdown;
  totals: TokenTotals;
}
export interface UsageAuditModel {
  model: string;
  recordCount: number;
  usage: TokenBreakdown;
  totals: TokenTotals;
}
export interface UsageAuditReport {
  generatedAt: number;
  recordCount: number;
  sessionCount: number;
  firstTimestamp?: number;
  lastTimestamp?: number;
  usage: TokenBreakdown;
  totals: TokenTotals;
  bySource: UsageAuditSource[];
  byModel: UsageAuditModel[];
  daily: UsageAuditDay[];
  peakDays: UsageAuditDay[];
}

export interface RebuildAuditResult {
  before: UsageAuditReport;
  after: UsageAuditReport;
  difference: { records: number; tokens: number; percent: number };
}

export const zeroBreakdown = (): TokenBreakdown => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
});
export function addBreakdown(target: TokenBreakdown, usage: TokenUsage): void {
  target.inputTokens += usage.inputTokens;
  target.cachedInputTokens += usage.cachedInputTokens;
  target.cacheCreationInputTokens += usage.cacheCreationInputTokens;
  target.outputTokens += usage.outputTokens;
  target.reasoningOutputTokens += usage.reasoningOutputTokens;
}
function totalsFor(usage: TokenBreakdown): TokenTotals {
  const metrics = tokenMetricSet(usage);
  return {
    currentTotal: metrics.current,
    withoutCached: metrics.withoutCached,
    withoutCacheCreation: metrics.withoutCacheCreation,
    withoutReasoning: metrics.withoutReasoning,
    withoutAllCache: metrics.withoutAllCache,
    plainInputOutput: metrics.plainInputOutput,
    rawIoEquivalent: metrics.rawIoEquivalent,
  };
}
function localDay(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function compareTimestamp(left: number | undefined, right: number): number {
  return left === undefined ? right : Math.min(left, right);
}
function updateLatest(left: number | undefined, right: number): number {
  return left === undefined ? right : Math.max(left, right);
}

export function buildUsageAuditReport(records: readonly UsageRecord[], generatedAt = Date.now()): UsageAuditReport {
  const usage = zeroBreakdown();
  const sessions = new Set<string>();
  const sourceMap = new Map<AgentSource, { recordCount: number; sessions: Set<string>; first?: number; last?: number; usage: TokenBreakdown }>();
  const modelMap = new Map<string, { recordCount: number; usage: TokenBreakdown }>();
  const dayMap = new Map<string, TokenBreakdown>();
  let firstTimestamp: number | undefined;
  let lastTimestamp: number | undefined;
  for (const record of records) {
    addBreakdown(usage, record.usage);
    firstTimestamp = compareTimestamp(firstTimestamp, record.timestamp);
    lastTimestamp = updateLatest(lastTimestamp, record.timestamp);
    if (record.sessionId) sessions.add(`${record.source}:${record.sessionId}`);
    const source = sourceMap.get(record.source) ?? { recordCount: 0, sessions: new Set<string>(), usage: zeroBreakdown() };
    source.recordCount += 1;
    if (record.sessionId) source.sessions.add(record.sessionId);
    source.first = compareTimestamp(source.first, record.timestamp);
    source.last = updateLatest(source.last, record.timestamp);
    addBreakdown(source.usage, record.usage);
    sourceMap.set(record.source, source);
    const model = modelMap.get(record.model) ?? { recordCount: 0, usage: zeroBreakdown() };
    model.recordCount += 1;
    addBreakdown(model.usage, record.usage);
    modelMap.set(record.model, model);
    const dayUsage = dayMap.get(localDay(record.timestamp)) ?? zeroBreakdown();
    addBreakdown(dayUsage, record.usage);
    dayMap.set(localDay(record.timestamp), dayUsage);
  }
  const daily = [...dayMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day, dayUsage]) => ({ day, usage: dayUsage, totals: totalsFor(dayUsage) }));
  const bySource = [...sourceMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([source, value]) => ({ source, recordCount: value.recordCount, sessionCount: value.sessions.size, firstTimestamp: value.first, lastTimestamp: value.last, usage: value.usage, totals: totalsFor(value.usage) }));
  const byModel = [...modelMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([model, value]) => ({ model, recordCount: value.recordCount, usage: value.usage, totals: totalsFor(value.usage) }));
  return { generatedAt, recordCount: records.length, sessionCount: sessions.size, firstTimestamp, lastTimestamp, usage, totals: totalsFor(usage), bySource, byModel, daily, peakDays: [...daily].sort((left, right) => right.totals.currentTotal - left.totals.currentTotal).slice(0, 20) };
}

export class UsageAuditService {
  constructor(private readonly repository: UsageRepository) {}
  async audit(): Promise<UsageAuditReport> {
    return buildUsageAuditReport(await this.repository.getRecords());
  }
}
