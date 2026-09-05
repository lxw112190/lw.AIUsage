import {
  auditCodexRaw,
  type CodexRawAuditReport,
} from "@lw-aiusage/collectors";
import type { RuntimePlatform } from "@lw-aiusage/platform";

export type { CodexRawAuditReport } from "@lw-aiusage/collectors";

export class CodexRawAuditService {
  constructor(private readonly platform: RuntimePlatform) {}
  async audit(onProgress?: (current: number, total: number) => void): Promise<CodexRawAuditReport> {
    return auditCodexRaw(this.platform, onProgress);
  }
}
