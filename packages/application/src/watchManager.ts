import type { AgentSource } from "@lw-aiusage/core";
import type { Collector } from "@lw-aiusage/collectors";
import type { RuntimePlatform, WatchHandle } from "@lw-aiusage/platform";

const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

export class WatchManager {
  private readonly handles = new Map<string, WatchHandle>();
  private activeReconcile?: Promise<void>;

  constructor(
    private readonly platform: RuntimePlatform,
    private readonly collectors: readonly Collector[],
    private readonly onChanged: () => void,
  ) {}

  async reconcile(): Promise<void> {
    if (!this.platform.watch) return;
    if (this.activeReconcile) return this.activeReconcile;
    const operation = this.reconcileInternal();
    this.activeReconcile = operation;
    try { await operation; } finally { if (this.activeReconcile === operation) this.activeReconcile = undefined; }
  }

  private async reconcileInternal(): Promise<void> {
    const desired = new Map<string, { source: AgentSource; root: string }>();
    for (const collector of this.collectors) {
      const detection = await collector.detect({ platform: this.platform });
      for (const root of detection.roots) if (await this.platform.fs.exists(root)) desired.set(`${collector.source}:${root}`, { source: collector.source, root });
    }
    for (const [key, handle] of this.handles) {
      if (!desired.has(key)) { await handle.close(); this.handles.delete(key); }
    }
    for (const [key, item] of desired) {
      if (this.handles.has(key)) continue;
      this.handles.set(key, await this.platform.watch!.watch(item.root, { recursive: true }, this.onChanged));
    }
  }

  async close(): Promise<void> {
    const handles = [...this.handles.values()];
    this.handles.clear();
    await Promise.all(handles.map((handle) => handle.close()));
  }

  static intervalMs(): number { return RECONCILE_INTERVAL_MS; }
}
