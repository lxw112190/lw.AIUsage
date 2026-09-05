import { estimatedCostUsd, pricingForModel, totalTokens, type AgentSource, type UsageRecord } from "@lw-aiusage/core";
import type { UsageQuery, UsageRepository } from "@lw-aiusage/storage";

export interface UsageFilters extends UsageQuery { source?: AgentSource; model?: string; projectKey?: string; }
export interface UsageGroup { key: string; recordCount: number; totalTokens: number; estimatedCostUsd: number; }
export interface UsageReport { records: UsageRecord[]; totalTokens: number; estimatedCostUsd: number; byModel: UsageGroup[]; byProject: UsageGroup[]; }

const group = (records: readonly UsageRecord[], keyOf: (record: UsageRecord) => string): UsageGroup[] => {
  const groups = new Map<string, UsageGroup>();
  for (const record of records) {
    const key = keyOf(record); const pricing = pricingForModel(record.model); const current = groups.get(key);
    const tokens = totalTokens(record.usage); const cost = pricing ? estimatedCostUsd(record.usage, pricing) : 0;
    if (current) { current.recordCount += 1; current.totalTokens += tokens; current.estimatedCostUsd += cost; }
    else groups.set(key, { key, recordCount: 1, totalTokens: tokens, estimatedCostUsd: cost });
  }
  return [...groups.values()].sort((left, right) => right.totalTokens - left.totalTokens);
};

export class QueryService {
  constructor(private readonly repository: UsageRepository) {}
  async records(filters: UsageFilters = {}): Promise<UsageRecord[]> { return this.repository.getRecords(filters); }
  async report(filters: UsageFilters = {}): Promise<UsageReport> {
    const records = await this.records(filters);
    const cost = records.reduce((sum, record) => { const pricing = pricingForModel(record.model); return sum + (pricing ? estimatedCostUsd(record.usage, pricing) : 0); }, 0);
    return { records, totalTokens: records.reduce((sum, record) => sum + totalTokens(record.usage), 0), estimatedCostUsd: cost, byModel: group(records, (record) => record.model), byProject: group(records, (record) => record.projectKey) };
  }
}
