import { totalTokens, type TokenUsage } from "@lw-aiusage/core";
import type { UsageRepository, SourceUsageSummary } from "@lw-aiusage/storage";
import { auditCodexRaw, type CodexRawAuditReport } from "@lw-aiusage/collectors";
import type { RuntimePlatform } from "@lw-aiusage/platform";

export interface CodexAccountingAuditReport {
  auditVersion: 3;
  parserVersion: 4;
  accounting: "codex-accounting-audit-v3";
  generatedAt: number;
  snapshotStable: boolean;
  raw: CodexRawAuditReport;
  database: SourceUsageSummary;
  reconciliation: {
    parserEquivalentV4Tokens: number;
    databaseTokens: number;
    differenceTokens: number;
    differencePercent: number;
    recordCount: number;
    matched: boolean;
  };
}

export class CodexAccountingAuditService {
  constructor(private readonly platform: RuntimePlatform, private readonly repository: UsageRepository) {}

  async audit(onProgress?: (current: number, total: number) => void, snapshotStable = true): Promise<CodexAccountingAuditReport> {
    const raw = await auditCodexRaw(this.platform, onProgress);
    const database = await this.repository.getSourceUsageSummary("codex");
    const parserEquivalentV4Tokens = totalTokens(raw.methods.parserEquivalentV4AllEvents);
    const differenceTokens = parserEquivalentV4Tokens - database.totalTokens;
    return {
      auditVersion: 3,
      parserVersion: 4,
      accounting: "codex-accounting-audit-v3",
      generatedAt: Date.now(),
      snapshotStable,
      raw,
      database,
      reconciliation: {
        parserEquivalentV4Tokens,
        databaseTokens: database.totalTokens,
        differenceTokens,
        differencePercent: database.totalTokens ? (differenceTokens / database.totalTokens) * 100 : 0,
        recordCount: database.recordCount,
        matched: snapshotStable && differenceTokens === 0,
      },
    };
  }
}

export type { TokenUsage };
