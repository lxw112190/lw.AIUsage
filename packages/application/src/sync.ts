import { aggregateBuckets, type UsageRecord } from "@lw-aiusage/core";
import type { Collector, CollectorProgress, JsonlParserPort } from "@lw-aiusage/collectors";
import type { RuntimePlatform, WatchHandle } from "@lw-aiusage/platform";
import type { UsageRepository } from "@lw-aiusage/storage";

export interface SyncResult { files: number; inserted: number; diagnostics: string[]; }
export class SyncManager {
  private watching = false;
  constructor(private readonly platform: RuntimePlatform, private readonly repository: UsageRepository, private readonly collectors: readonly Collector[], private readonly parser?: JsonlParserPort) {}
  async sync(onProgress?: (progress: CollectorProgress) => void): Promise<SyncResult> {
    let files = 0; let inserted = 0; const diagnostics: string[] = [];
    const cursors = await this.repository.getCursors();
    for (const collector of this.collectors) {
      const discovered = await collector.discoverFiles({ platform: this.platform, parser: this.parser, onProgress });
      files += discovered.length;
      for (const file of discovered) {
        const cursor = cursors.find((item) => item.key === `${collector.source}:${file.path}`);
        const scanned = await collector.scanFile({ platform: this.platform, file, cursor, parser: this.parser, onProgress });
        inserted += await this.repository.commitScan(scanned.records, scanned.cursor);
        diagnostics.push(...scanned.diagnostics);
      }
    }
    const allRecords = await this.repository.getRecords();
    await this.repository.putBuckets(aggregateBuckets(allRecords));
    return { files, inserted, diagnostics };
  }
  async startWatching(onSync?: (result: SyncResult) => void): Promise<WatchHandle> {
    if (!this.platform.watch || this.watching) return { close: async () => undefined };
    this.watching = true;
    const handles: WatchHandle[] = []; let timer: ReturnType<typeof setTimeout> | undefined; let running = false; let queued = false;
    const schedule = (): void => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = undefined; if (running) { queued = true; return; } running = true; void this.sync().then((result) => onSync?.(result)).catch((cause: unknown) => onSync?.({ files: 0, inserted: 0, diagnostics: [cause instanceof Error ? cause.message : "WATCH_SYNC_FAILED"] })).finally(() => { running = false; if (queued) { queued = false; schedule(); } }); }, 500); };
    for (const collector of this.collectors) { const detection = await collector.detect({ platform: this.platform }); if (!detection.installed) continue; for (const root of detection.roots) if (await this.platform.fs.exists(root)) handles.push(await this.platform.watch.watch(root, { recursive: true }, schedule)); }
    return { close: async () => { this.watching = false; if (timer) clearTimeout(timer); await Promise.all(handles.map((handle) => handle.close())); } };
  }
}
export interface DashboardSummary { records: number; totalTokens: number; estimatedCostUsd: number; bySource: Record<string, number>; }
export async function getDashboardSummary(repository: UsageRepository): Promise<DashboardSummary> {
  const records: UsageRecord[] = await repository.getRecords();
  const bySource: Record<string, number> = {};
  for (const record of records) bySource[record.source] = (bySource[record.source] ?? 0) + record.usage.inputTokens + record.usage.cachedInputTokens + record.usage.cacheCreationInputTokens + record.usage.outputTokens + record.usage.reasoningOutputTokens;
  const { pricingForModel, estimatedCostUsd } = await import("@lw-aiusage/core");
  const estimated = records.reduce((sum, record) => { const pricing = pricingForModel(record.model); return sum + (pricing ? estimatedCostUsd(record.usage, pricing) : 0); }, 0);
  return { records: records.length, totalTokens: Object.values(bySource).reduce((sum, value) => sum + value, 0), estimatedCostUsd: estimated, bySource };
}
