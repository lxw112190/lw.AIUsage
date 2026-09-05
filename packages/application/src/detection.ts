import type { AgentSource } from "@lw-aiusage/core";
import type { Collector } from "@lw-aiusage/collectors";
import type { RuntimePlatform } from "@lw-aiusage/platform";

export type CollectorStatus = "NotDetected" | "Ready" | "Active";
export interface CollectorDetectionResult {
  source: AgentSource;
  name: string;
  status: CollectorStatus;
  installed: boolean;
  dataAvailable: boolean;
  roots: string[];
}
export async function detectCollectors(
  platform: RuntimePlatform,
  collectors: readonly Collector[],
): Promise<CollectorDetectionResult[]> {
  return Promise.all(
    collectors.map(async (collector) => {
      const result = await collector.detect({ platform });
      const status: CollectorStatus = !result.installed
        ? "NotDetected"
        : result.dataAvailable
          ? "Active"
          : "Ready";
      return {
        source: collector.source,
        name: collector.name,
        status,
        installed: result.installed,
        dataAvailable: result.dataAvailable,
        roots: result.roots,
      };
    }),
  );
}
