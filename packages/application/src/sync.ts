import { aggregateBuckets } from "@lw-aiusage/core";
import type {
  Collector,
  CollectorFile,
  CollectorProgress,
  JsonlParserPort,
  SourceCollector,
} from "@lw-aiusage/collectors";
import type { RuntimePlatform, WatchHandle } from "@lw-aiusage/platform";
import type { FileCursor, UsageRepository } from "@lw-aiusage/storage";
import { reconcileCollectorFiles } from "./sessionReconcile";
import { WatchManager } from "./watchManager";
import { QueryService } from "./query";

export interface SyncResult {
  files: number;
  inserted: number;
  skipped: number;
  diagnostics: string[];
}
export class SyncManager {
  private watching = false;
  private activeSync?: Promise<SyncResult>;
  private watchManager?: WatchManager;
  constructor(
    private readonly platform: RuntimePlatform,
    private readonly repository: UsageRepository,
    private readonly collectors: readonly Collector[],
    private readonly parser?: JsonlParserPort,
  ) {}
  async sync(
    onProgress?: (progress: CollectorProgress) => void,
  ): Promise<SyncResult> {
    if (this.activeSync) return this.activeSync;
    const operation = this.syncInternal(onProgress);
    this.activeSync = operation;
    try {
      return await operation;
    } finally {
      if (this.activeSync === operation) this.activeSync = undefined;
    }
  }
  async waitForIdle(): Promise<void> {
    await this.activeSync;
  }
  private async syncInternal(
    onProgress?: (progress: CollectorProgress) => void,
  ): Promise<SyncResult> {
    let files = 0;
    let inserted = 0;
    let skipped = 0;
    const diagnostics: string[] = [];
    const cursors = await this.repository.getCursors();
    for (const collector of this.collectors) {
      const discovered = await collector.discoverFiles({
        platform: this.platform,
        cursors,
        parser: this.parser,
        onProgress,
      });
      files += discovered.length;
      if (collector.scanMode === "source") {
        if (!sourceNeedsScan(collector, discovered, cursors)) {
          skipped += discovered.length;
          continue;
        }
        const scanned = await collector.scanSource({
          platform: this.platform,
          files: discovered,
          cursors,
          parser: this.parser,
          onProgress,
        });
        diagnostics.push(...scanned.diagnostics);
        if (!scanned.safeToCommit) continue;
        const currentRecords = await this.repository.getRecords();
        const nextBuckets = aggregateBuckets([
          ...currentRecords.filter((record) => record.source !== collector.source),
          ...scanned.records,
        ]);
        const replaced = await this.repository.replaceSourceSnapshot(
          collector.source,
          scanned.records,
          scanned.cursors,
          nextBuckets,
        );
        inserted += replaced.recordChanges;
        continue;
      }
      const reconciled = await reconcileCollectorFiles(
        this.repository,
        collector.source,
        collector.fileReconcileMode,
        discovered,
        cursors,
      );
      for (const item of reconciled) {
        if (item.shadowDuplicate) { skipped += 1; continue; }
        const file = item.file;
        const cursor = item.cursor ?? cursors.find((candidate) => candidate.key === `${collector.source}:${file.path}`);
        if (
          !item.forceScan &&
          cursor &&
          cursor.parserVersion === collector.parserVersion &&
          cursor.size === file.size &&
          cursor.modifiedAt === file.modifiedAt &&
          cursor.offset >= file.size
        ) {
          skipped += 1;
          continue;
        }
        const scanned = await collector.scanFile({
          platform: this.platform,
          file,
          cursor,
          cursors,
          parser: this.parser,
          onProgress,
        });
        inserted += await this.repository.commitScan(
          scanned.records,
          scanned.cursor,
          { replaceRecords: scanned.replaceRecords },
        );
        diagnostics.push(...scanned.diagnostics);
      }
    }
    if (inserted > 0) {
      const allRecords = await this.repository.getRecords();
      await this.repository.putBuckets(aggregateBuckets(allRecords));
    }
    return { files, inserted, skipped, diagnostics };
  }
  async startWatching(
    onSync?: (result: SyncResult) => void,
  ): Promise<WatchHandle> {
    if (!this.platform.watch || this.watching)
      return { close: async () => undefined };
    this.watching = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    let running = false;
    let queued = false;
    let closed = false;
    let watchManager: WatchManager;
    const runScheduledSync = (): void => {
      running = true;
      void this.sync()
        .then(async (result) => { await watchManager.reconcile(); onSync?.(result); })
        .catch((cause: unknown) => onSync?.({ files: 0, inserted: 0, skipped: 0, diagnostics: [cause instanceof Error ? cause.message : "WATCH_SYNC_FAILED"] }))
        .finally(() => { running = false; if (queued) { queued = false; schedule(); } });
    };
    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (running) {
          queued = true;
          return;
        }
        runScheduledSync();
      }, 500);
    };
    watchManager = new WatchManager(this.platform, this.collectors, schedule);
    this.watchManager = watchManager;
    try { await watchManager.reconcile(); } catch (cause) { this.watching = false; this.watchManager = undefined; throw cause; }
    interval = setInterval(() => { void watchManager.reconcile().catch(() => undefined); }, WatchManager.intervalMs());
    return {
      close: async () => {
        if (closed) return;
        closed = true;
        this.watching = false;
        if (timer) clearTimeout(timer);
        if (interval) clearInterval(interval);
        this.watchManager = undefined;
        await watchManager.close();
      },
    };
  }
}

export function sourceNeedsScan(
  collector: SourceCollector,
  files: readonly CollectorFile[],
  cursors: readonly FileCursor[],
): boolean {
  const sourceCursors = cursors.filter((cursor) => cursor.source === collector.source);
  if (sourceCursors.length !== files.length) return true;
  const cursorByPath = new Map(sourceCursors.map((cursor) => [cursor.path, cursor]));
  for (const file of files) {
    const cursor = cursorByPath.get(file.path);
    if (!cursor) return true;
    if (cursor.parserVersion !== collector.parserVersion) return true;
    if (cursor.size !== file.size || cursor.modifiedAt !== file.modifiedAt) return true;
    if (cursor.offset !== file.size || cursor.pendingText !== "") return true;
    if (cursor.logicalId !== file.logicalId) return true;
  }
  return false;
}
export interface DashboardSummary {
  records: number;
  totalTokens: number;
  estimatedCostUsd: number;
  bySource: Record<string, number>;
}
export async function getDashboardSummary(
  repository: UsageRepository,
): Promise<DashboardSummary> {
  const dashboard = await new QueryService(repository).dashboard();
  return {
    records: dashboard.records,
    totalTokens: dashboard.totalTokens,
    estimatedCostUsd: dashboard.estimatedCostUsd,
    bySource: dashboard.bySource,
  };
}
