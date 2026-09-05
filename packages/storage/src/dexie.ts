import Dexie, { type Table } from "dexie";
import type { ProjectRecord, SessionRecord, UsageBucket, UsageRecord } from "@lw-aiusage/core";
import type { FileCursor, UsageQuery, UsageRepository } from "./repository";

class AiUsageDatabase extends Dexie {
  records!: Table<UsageRecord, string>; buckets!: Table<UsageBucket, string>; cursors!: Table<FileCursor, string>; projects!: Table<ProjectRecord, string>; sessions!: Table<SessionRecord, string>;
  constructor(name: string) { super(name); this.version(1).stores({ records: "id,timestamp,source,model,projectKey", buckets: "id,bucketStart,source,model,projectKey", cursors: "key,source,path", projects: "key,lastActiveAt", sessions: "id,source,lastActiveAt" }); }
}
const matches = (query: UsageQuery, item: { timestamp?: number; bucketStart?: number; source: string; model: string; projectKey: string }): boolean => {
  const time = item.timestamp ?? item.bucketStart ?? 0;
  return (!query.from || time >= query.from) && (!query.to || time < query.to) && (!query.source || item.source === query.source) && (!query.model || item.model === query.model) && (!query.projectKey || item.projectKey === query.projectKey);
};
export class DexieUsageRepository implements UsageRepository {
  readonly db: AiUsageDatabase;
  constructor(name = "lw.AIUsage-dev") { this.db = new AiUsageDatabase(name); }
  async putRecords(records: readonly UsageRecord[]): Promise<number> { let inserted = 0; await this.db.transaction("rw", this.db.records, async () => { for (const record of records) if (!(await this.db.records.get(record.id))) { await this.db.records.add(record); inserted += 1; } }); return inserted; }
  async commitScan(records: readonly UsageRecord[], cursor: FileCursor): Promise<number> { let inserted = 0; await this.db.transaction("rw", this.db.records, this.db.cursors, async () => { for (const record of records) if (!(await this.db.records.get(record.id))) { await this.db.records.add(record); inserted += 1; } await this.db.cursors.put(cursor); }); return inserted; }
  async getRecords(query: UsageQuery = {}): Promise<UsageRecord[]> { return (await this.db.records.toArray()).filter((item) => matches(query, item)).sort((a, b) => a.timestamp - b.timestamp); }
  async getBuckets(query: UsageQuery = {}): Promise<UsageBucket[]> { return (await this.db.buckets.toArray()).filter((item) => matches(query, item)).sort((a, b) => a.bucketStart - b.bucketStart); }
  async putBuckets(buckets: readonly UsageBucket[]): Promise<void> { await this.db.transaction("rw", this.db.buckets, async () => { for (const bucket of buckets) await this.db.buckets.put(bucket); }); }
  async getCursors(): Promise<FileCursor[]> { return this.db.cursors.toArray(); }
  async putCursor(cursor: FileCursor): Promise<void> { await this.db.cursors.put(cursor); }
  async getProjects(): Promise<ProjectRecord[]> { return this.db.projects.toArray(); }
  async putProject(project: ProjectRecord): Promise<void> { await this.db.projects.put(project); }
  async putSession(session: SessionRecord): Promise<void> { await this.db.sessions.put(session); }
  async resetStatistics(): Promise<void> { await this.db.transaction("rw", this.db.records, this.db.buckets, this.db.cursors, this.db.sessions, async () => { await Promise.all([this.db.records.clear(), this.db.buckets.clear(), this.db.cursors.clear(), this.db.sessions.clear()]); }); }
}
