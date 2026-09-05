import Dexie, { type Table } from "dexie";
import type {
  ProjectRecord,
  SessionRecord,
  UsageBucket,
  UsageRecord,
} from "@lw-aiusage/core";
import type {
  CommitScanOptions,
  FileCursor,
  UsagePageQuery,
  UsagePageResult,
  UsageQuery,
  UsageRepository,
} from "./repository";

class AiUsageDatabase extends Dexie {
  records!: Table<UsageRecord, string>;
  buckets!: Table<UsageBucket, string>;
  cursors!: Table<FileCursor, string>;
  projects!: Table<ProjectRecord, string>;
  sessions!: Table<SessionRecord, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      records: "id,timestamp,source,model,projectKey",
      buckets: "id,bucketStart,source,model,projectKey",
      cursors: "key,source,path",
      projects: "key,lastActiveAt",
      sessions: "id,source,lastActiveAt",
    });
    this.version(2).stores({
      records: "id,timestamp,source,model,projectKey,sourcePath",
      buckets: "id,bucketStart,source,model,projectKey",
      cursors: "key,source,path",
      projects: "key,lastActiveAt",
      sessions: "id,source,lastActiveAt",
    });
    this.version(3).stores({
      records:
        "id,timestamp,source,model,projectKey,sourcePath,[timestamp+id],[source+timestamp+id],[model+timestamp+id],[projectKey+timestamp+id]",
      buckets: "id,bucketStart,source,model,projectKey",
      cursors: "key,source,path,logicalId",
      projects: "key,lastActiveAt",
      sessions: "id,source,lastActiveAt",
    });
  }
}
const matches = (
  query: UsageQuery,
  item: {
    timestamp?: number;
    bucketStart?: number;
    source: string;
    model: string;
    projectKey: string;
  },
): boolean => {
  const time = item.timestamp ?? item.bucketStart ?? 0;
  return (
    (query.from === undefined || time >= query.from) &&
    (query.to === undefined || time < query.to) &&
    (!query.source || item.source === query.source) &&
    (!query.model || item.model === query.model) &&
    (!query.projectKey || item.projectKey === query.projectKey)
  );
};
const recordsEqual = (left: UsageRecord, right: UsageRecord): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
export class DexieUsageRepository implements UsageRepository {
  readonly db: AiUsageDatabase;
  constructor(
    name = typeof window !== "undefined" && "lw" in window
      ? "lw.AIUsage"
      : "lw.AIUsage-dev",
  ) {
    this.db = new AiUsageDatabase(name);
  }
  async putRecords(records: readonly UsageRecord[]): Promise<number> {
    let changed = 0;
    await this.db.transaction("rw", this.db.records, async () => {
      for (const record of records) {
        const previous = await this.db.records.get(record.id);
        if (!previous || !recordsEqual(previous, record)) {
          await this.db.records.put(record);
          changed += 1;
        }
      }
    });
    return changed;
  }
  async commitScan(
    records: readonly UsageRecord[],
    cursor: FileCursor,
    options: CommitScanOptions = {},
  ): Promise<number> {
    let changed = 0;
    await this.db.transaction(
      "rw",
      this.db.records,
      this.db.cursors,
      async () => {
        if (options.replaceRecords) {
          const oldRecords = await this.db.records
            .where("source")
            .equals(cursor.source)
            .filter((record) => record.sourcePath === cursor.path)
            .toArray();
          for (const record of oldRecords) {
            await this.db.records.delete(record.id);
            changed += 1;
          }
        }
        for (const record of records) {
          const previous = await this.db.records.get(record.id);
          if (!previous || !recordsEqual(previous, record)) {
            await this.db.records.put(record);
            changed += 1;
          }
        }
        await this.db.cursors.put(cursor);
      },
    );
    return changed;
  }
  async migrateFileCursor(oldCursor: FileCursor, newFile: { path: string; size: number; modifiedAt: number; logicalId?: string }): Promise<FileCursor> {
    const reset = newFile.size < oldCursor.offset;
    const newCursor: FileCursor = { ...oldCursor, key: `${oldCursor.source}:${newFile.path}`, path: newFile.path, logicalId: newFile.logicalId ?? oldCursor.logicalId ?? oldCursor.parserState?.sessionId, size: newFile.size, modifiedAt: newFile.modifiedAt, ...(reset ? { offset: 0, pendingText: "", parserState: undefined } : {}) };
    await this.db.transaction("rw", this.db.records, this.db.cursors, async () => {
      const oldRecords = await this.db.records.where("sourcePath").equals(oldCursor.path).toArray();
      for (const record of oldRecords) if (record.source === oldCursor.source) await this.db.records.put({ ...record, sourcePath: newFile.path });
      await this.db.cursors.delete(oldCursor.key);
      await this.db.cursors.put(newCursor);
    });
    return newCursor;
  }
  async getRecords(query: UsageQuery = {}): Promise<UsageRecord[]> {
    const collection =
      query.from !== undefined || query.to !== undefined
        ? this.db.records
            .where("timestamp")
            .between(
              query.from ?? Dexie.minKey,
              query.to ?? Dexie.maxKey,
              true,
              false,
            )
        : this.db.records.toCollection();
    return (await collection.toArray())
      .filter((item) => matches(query, item))
      .sort((a, b) => a.timestamp - b.timestamp);
  }
  async getRecordsPage(query: UsagePageQuery): Promise<UsagePageResult> {
    const pageSize = Math.max(1, Math.floor(query.pageSize));
    const requestedPage = Math.max(1, Math.floor(query.page));
    const collection = this.recordCollection(query);
    const filtered = collection.filter((item) => matches(query, item));
    const total = await filtered.count();
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const ordered = query.order === "asc" ? filtered : filtered.reverse();
    const items = await ordered
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .toArray();
    return { items, page, pageSize, total, totalPages };
  }
  async getModelOptions(): Promise<string[]> {
    return [...new Set((await this.db.records.orderBy("model").uniqueKeys()).map(String))];
  }
  async getProjectOptions(): Promise<string[]> {
    return [...new Set((await this.db.records.orderBy("projectKey").uniqueKeys()).map(String))];
  }
  async getBuckets(query: UsageQuery = {}): Promise<UsageBucket[]> {
    const collection =
      query.from !== undefined || query.to !== undefined
        ? this.db.buckets
            .where("bucketStart")
            .between(
              query.from ?? Dexie.minKey,
              query.to ?? Dexie.maxKey,
              true,
              false,
            )
        : this.db.buckets.toCollection();
    return (await collection.toArray())
      .filter((item) => matches(query, item))
      .sort((a, b) => a.bucketStart - b.bucketStart);
  }
  async putBuckets(buckets: readonly UsageBucket[]): Promise<void> {
    await this.db.transaction("rw", this.db.buckets, async () => {
      await this.db.buckets.clear();
      for (const bucket of buckets) await this.db.buckets.put(bucket);
    });
  }
  async getCursors(): Promise<FileCursor[]> {
    return this.db.cursors.toArray();
  }
  async putCursor(cursor: FileCursor): Promise<void> {
    await this.db.cursors.put(cursor);
  }
  async getProjects(): Promise<ProjectRecord[]> {
    return this.db.projects.toArray();
  }
  async putProject(project: ProjectRecord): Promise<void> {
    await this.db.projects.put(project);
  }
  async putSession(session: SessionRecord): Promise<void> {
    await this.db.sessions.put(session);
  }
  async resetStatistics(): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.records,
      this.db.buckets,
      this.db.cursors,
      this.db.sessions,
      async () => {
        await Promise.all([
          this.db.records.clear(),
          this.db.buckets.clear(),
          this.db.cursors.clear(),
          this.db.sessions.clear(),
        ]);
      },
    );
  }
  private recordCollection(query: UsageQuery) {
    const from = query.from ?? Dexie.minKey;
    const to = query.to ?? Dexie.maxKey;
    if (query.projectKey)
      return this.db.records
        .where("[projectKey+timestamp+id]")
        .between(
          [query.projectKey, from, Dexie.minKey],
          [query.projectKey, to, Dexie.maxKey],
          true,
          false,
        );
    if (query.model)
      return this.db.records
        .where("[model+timestamp+id]")
        .between(
          [query.model, from, Dexie.minKey],
          [query.model, to, Dexie.maxKey],
          true,
          false,
        );
    if (query.source)
      return this.db.records
        .where("[source+timestamp+id]")
        .between(
          [query.source, from, Dexie.minKey],
          [query.source, to, Dexie.maxKey],
          true,
          false,
        );
    if (query.from !== undefined || query.to !== undefined)
      return this.db.records
        .where("[timestamp+id]")
        .between(
          [from, Dexie.minKey],
          [to, Dexie.maxKey],
          true,
          false,
        );
    return this.db.records.orderBy("[timestamp+id]");
  }
}
