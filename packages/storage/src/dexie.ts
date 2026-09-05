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
}
