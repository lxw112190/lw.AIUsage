import type {
  AgentSource,
  ProjectRecord,
  SessionRecord,
  UsageBucket,
  UsageParserState,
  UsageRecord,
  TokenUsage,
} from "@lw-aiusage/core";

export interface FileCursor {
  key: string;
  source: AgentSource;
  path: string;
  logicalId?: string;
  offset: number;
  size: number;
  modifiedAt: number;
  pendingText: string;
  parserVersion: number;
  parserState?: UsageParserState;
}
export interface CommitScanOptions {
  replaceRecords?: boolean;
}
export interface MigratedFile {
  path: string;
  size: number;
  modifiedAt: number;
  logicalId?: string;
}
export interface UsageQuery {
  from?: number;
  to?: number;
  source?: string;
  model?: string;
  projectKey?: string;
}
export interface UsagePageQuery extends UsageQuery {
  page: number;
  pageSize: number;
  order?: "asc" | "desc";
}
export interface UsagePageResult {
  items: UsageRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface SourceUsageSummary {
  source: AgentSource;
  recordCount: number;
  sessionCount: number;
  usage: UsageRecord["usage"];
  totalTokens: number;
}
export interface SourceAuditRecord {
  id: string;
  sessionId?: string;
  timestamp: number;
  model: string;
  projectKey: string;
  usage: TokenUsage;
}
export interface UsageRepository {
  putRecords(records: readonly UsageRecord[]): Promise<number>;
  commitScan(
    records: readonly UsageRecord[],
    cursor: FileCursor,
    options?: CommitScanOptions,
  ): Promise<number>;
  migrateFileCursor(oldCursor: FileCursor, newFile: MigratedFile): Promise<FileCursor>;
  getRecords(query?: UsageQuery): Promise<UsageRecord[]>;
  getRecordsPage(query: UsagePageQuery): Promise<UsagePageResult>;
  getModelOptions(): Promise<string[]>;
  getProjectOptions(): Promise<string[]>;
  getBuckets(query?: UsageQuery): Promise<UsageBucket[]>;
  getSourceUsageSummary(source: AgentSource): Promise<SourceUsageSummary>;
  getSourceAuditRecords(source: AgentSource): Promise<SourceAuditRecord[]>;
  putBuckets(buckets: readonly UsageBucket[]): Promise<void>;
  getCursors(): Promise<FileCursor[]>;
  putCursor(cursor: FileCursor): Promise<void>;
  getProjects(): Promise<ProjectRecord[]>;
  putProject(project: ProjectRecord): Promise<void>;
  putSession(session: SessionRecord): Promise<void>;
  resetStatistics(): Promise<void>;
}

export class MemoryUsageRepository implements UsageRepository {
  private records = new Map<string, UsageRecord>();
  private buckets = new Map<string, UsageBucket>();
  private cursors = new Map<string, FileCursor>();
  private projects = new Map<string, ProjectRecord>();
  private sessions = new Map<string, SessionRecord>();
  async putRecords(records: readonly UsageRecord[]): Promise<number> {
    let changed = 0;
    for (const record of records) {
      const previous = this.records.get(record.id);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(record)) {
        this.records.set(record.id, record);
        changed += 1;
      }
    }
    return changed;
  }
  async commitScan(
    records: readonly UsageRecord[],
    cursor: FileCursor,
    options: { replaceRecords?: boolean } = {},
  ): Promise<number> {
    let changed = 0;
    if (options.replaceRecords) {
      for (const [id, record] of this.records)
        if (
          record.source === cursor.source &&
          record.sourcePath === cursor.path
        ) {
          this.records.delete(id);
          changed += 1;
        }
    }
    changed += await this.putRecords(records);
    await this.putCursor(cursor);
    return changed;
  }
  async migrateFileCursor(oldCursor: FileCursor, newFile: MigratedFile): Promise<FileCursor> {
    const reset = newFile.size < oldCursor.offset;
    const newCursor: FileCursor = { ...oldCursor, key: `${oldCursor.source}:${newFile.path}`, path: newFile.path, logicalId: newFile.logicalId ?? oldCursor.logicalId ?? oldCursor.parserState?.sessionId, size: newFile.size, modifiedAt: newFile.modifiedAt, ...(reset ? { offset: 0, pendingText: "", parserState: undefined } : {}) };
    for (const [id, record] of this.records) if (record.source === oldCursor.source && record.sourcePath === oldCursor.path) this.records.set(id, { ...record, sourcePath: newFile.path });
    this.cursors.delete(oldCursor.key);
    this.cursors.set(newCursor.key, newCursor);
    return newCursor;
  }
  async getRecords(query: UsageQuery = {}): Promise<UsageRecord[]> {
    return [...this.records.values()]
      .filter(
        (record) =>
          (query.from === undefined || record.timestamp >= query.from) &&
          (query.to === undefined || record.timestamp < query.to) &&
          (!query.source || record.source === query.source) &&
          (!query.model || record.model === query.model) &&
          (!query.projectKey || record.projectKey === query.projectKey),
      )
      .sort((a, b) => a.timestamp - b.timestamp);
  }
  async getRecordsPage(query: UsagePageQuery): Promise<UsagePageResult> {
    const pageSize = Math.max(1, Math.floor(query.pageSize));
    const page = Math.max(1, Math.floor(query.page));
    const items = [...this.records.values()]
      .filter(
        (record) =>
          (query.from === undefined || record.timestamp >= query.from) &&
          (query.to === undefined || record.timestamp < query.to) &&
          (!query.source || record.source === query.source) &&
          (!query.model || record.model === query.model) &&
          (!query.projectKey || record.projectKey === query.projectKey),
      )
      .sort((left, right) => {
        const timestamp = left.timestamp - right.timestamp;
        if (timestamp !== 0) return query.order === "asc" ? timestamp : -timestamp;
        const id = left.id.localeCompare(right.id);
        return query.order === "asc" ? id : -id;
      });
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    return {
      items: items.slice((safePage - 1) * pageSize, safePage * pageSize),
      page: safePage,
      pageSize,
      total,
      totalPages,
    };
  }
  async getModelOptions(): Promise<string[]> {
    return [...new Set([...this.records.values()].map((record) => record.model))].sort();
  }
  async getProjectOptions(): Promise<string[]> {
    return [...new Set([...this.records.values()].map((record) => record.projectKey))].sort();
  }
  async getBuckets(query: UsageQuery = {}): Promise<UsageBucket[]> {
    return [...this.buckets.values()]
      .filter(
        (bucket) =>
          (query.from === undefined || bucket.bucketStart >= query.from) &&
          (query.to === undefined || bucket.bucketStart < query.to) &&
          (!query.source || bucket.source === query.source) &&
          (!query.model || bucket.model === query.model) &&
          (!query.projectKey || bucket.projectKey === query.projectKey),
      )
      .sort((a, b) => a.bucketStart - b.bucketStart);
  }
  async getSourceUsageSummary(source: AgentSource): Promise<SourceUsageSummary> {
    const records = await this.getRecords({ source });
    const usage = records.reduce((total, record) => ({
      inputTokens: total.inputTokens + record.usage.inputTokens,
      cachedInputTokens: total.cachedInputTokens + record.usage.cachedInputTokens,
      cacheCreationInputTokens: total.cacheCreationInputTokens + record.usage.cacheCreationInputTokens,
      outputTokens: total.outputTokens + record.usage.outputTokens,
      reasoningOutputTokens: total.reasoningOutputTokens + record.usage.reasoningOutputTokens,
    }), { inputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 });
    return { source, recordCount: records.length, sessionCount: new Set(records.filter((record) => record.sessionId).map((record) => record.sessionId)).size, usage, totalTokens: Object.values(usage).reduce((sum, value) => sum + value, 0) };
  }
  async getSourceAuditRecords(source: AgentSource): Promise<SourceAuditRecord[]> {
    return (await this.getRecords({ source })).map((record) => ({
      id: record.id,
      sessionId: record.sessionId,
      timestamp: record.timestamp,
      model: record.model,
      projectKey: record.projectKey,
      usage: { ...record.usage },
    }));
  }
  async putBuckets(buckets: readonly UsageBucket[]): Promise<void> {
    this.buckets.clear();
    for (const bucket of buckets) this.buckets.set(bucket.id, bucket);
  }
  async getCursors(): Promise<FileCursor[]> {
    return [...this.cursors.values()];
  }
  async putCursor(cursor: FileCursor): Promise<void> {
    this.cursors.set(cursor.key, cursor);
  }
  async getProjects(): Promise<ProjectRecord[]> {
    return [...this.projects.values()];
  }
  async putProject(project: ProjectRecord): Promise<void> {
    this.projects.set(project.key, project);
  }
  async putSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.id, session);
  }
  async resetStatistics(): Promise<void> {
    this.records.clear();
    this.buckets.clear();
    this.cursors.clear();
    this.sessions.clear();
  }
}
