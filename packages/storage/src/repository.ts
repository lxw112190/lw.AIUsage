import type { ProjectRecord, SessionRecord, UsageBucket, UsageRecord } from "@lw-aiusage/core";

export interface FileCursor { key: string; source: string; path: string; offset: number; size: number; modifiedAt: number; pendingText: string; parserVersion: number; }
export interface UsageQuery { from?: number; to?: number; source?: string; model?: string; projectKey?: string; }
export interface UsageRepository {
  putRecords(records: readonly UsageRecord[]): Promise<number>;
  commitScan(records: readonly UsageRecord[], cursor: FileCursor): Promise<number>;
  getRecords(query?: UsageQuery): Promise<UsageRecord[]>;
  getBuckets(query?: UsageQuery): Promise<UsageBucket[]>;
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
  async putRecords(records: readonly UsageRecord[]): Promise<number> { let inserted = 0; for (const record of records) if (!this.records.has(record.id)) { this.records.set(record.id, record); inserted += 1; } return inserted; }
  async commitScan(records: readonly UsageRecord[], cursor: FileCursor): Promise<number> { const inserted = await this.putRecords(records); await this.putCursor(cursor); return inserted; }
  async getRecords(query: UsageQuery = {}): Promise<UsageRecord[]> { return [...this.records.values()].filter((record) => (!query.from || record.timestamp >= query.from) && (!query.to || record.timestamp < query.to) && (!query.source || record.source === query.source) && (!query.model || record.model === query.model) && (!query.projectKey || record.projectKey === query.projectKey)).sort((a, b) => a.timestamp - b.timestamp); }
  async getBuckets(query: UsageQuery = {}): Promise<UsageBucket[]> { return [...this.buckets.values()].filter((bucket) => (!query.from || bucket.bucketStart >= query.from) && (!query.to || bucket.bucketStart < query.to) && (!query.source || bucket.source === query.source) && (!query.model || bucket.model === query.model) && (!query.projectKey || bucket.projectKey === query.projectKey)).sort((a, b) => a.bucketStart - b.bucketStart); }
  async putBuckets(buckets: readonly UsageBucket[]): Promise<void> { for (const bucket of buckets) this.buckets.set(bucket.id, bucket); }
  async getCursors(): Promise<FileCursor[]> { return [...this.cursors.values()]; }
  async putCursor(cursor: FileCursor): Promise<void> { this.cursors.set(cursor.key, cursor); }
  async getProjects(): Promise<ProjectRecord[]> { return [...this.projects.values()]; }
  async putProject(project: ProjectRecord): Promise<void> { this.projects.set(project.key, project); }
  async putSession(session: SessionRecord): Promise<void> { this.sessions.set(session.id, session); }
  async resetStatistics(): Promise<void> { this.records.clear(); this.buckets.clear(); this.cursors.clear(); this.sessions.clear(); }
}
