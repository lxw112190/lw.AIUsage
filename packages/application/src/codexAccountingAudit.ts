import { totalTokens, type TokenUsage } from "@lw-aiusage/core";
import type { UsageRepository, SourceUsageSummary } from "@lw-aiusage/storage";
import { auditCodexRaw, snapshotCodexSource, type CodexRawAuditReport } from "@lw-aiusage/collectors";
import type { RuntimePlatform } from "@lw-aiusage/platform";

export interface CodexAccountingAuditReport {
  auditVersion: 3;
  parserVersion: 4;
  accounting: "codex-accounting-audit-v3";
  generatedAt: number;
  snapshotStable: boolean;
  snapshot: { beforeFingerprint: string; afterFingerprint: string };
  raw: CodexRawAuditReport;
  database: SourceUsageSummary;
  reconciliation: {
    parserEquivalentV4Tokens: number;
    databaseTokens: number;
    differenceTokens: number;
    differencePercent: number;
    recordCount: number;
    mirrorRecordCount: number;
    matched: boolean;
  };
}

export class CodexAccountingAuditService {
  constructor(private readonly platform: RuntimePlatform, private readonly repository: UsageRepository, private readonly syncBeforeAudit?: () => Promise<unknown>) {}

  async audit(onProgress?: (current: number, total: number) => void): Promise<CodexAccountingAuditReport> {
    let beforeSnapshot = await snapshotCodexSource(this.platform);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const beforeSync = beforeSnapshot;
      await this.syncBeforeAudit?.();
      beforeSnapshot = await snapshotCodexSource(this.platform);
      if (beforeSync.fingerprint === beforeSnapshot.fingerprint || !this.syncBeforeAudit) break;
    }
    const databaseBefore = await this.repository.getSourceUsageSummary("codex");
    const raw = await auditCodexRaw(this.platform, onProgress, { snapshot: beforeSnapshot });
    const afterSnapshot = await snapshotCodexSource(this.platform);
    const database = await this.repository.getSourceUsageSummary("codex");
    const snapshotStable = beforeSnapshot.fingerprint === afterSnapshot.fingerprint && sameSummary(databaseBefore, database);
    const parserEquivalentV4Tokens = totalTokens(raw.methods.parserEquivalentV4Unique);
    const differenceTokens = parserEquivalentV4Tokens - database.totalTokens;
    return {
      auditVersion: 3,
      parserVersion: 4,
      accounting: "codex-accounting-audit-v3",
      generatedAt: Date.now(),
      snapshotStable,
      snapshot: { beforeFingerprint: beforeSnapshot.fingerprint, afterFingerprint: afterSnapshot.fingerprint },
      raw,
      database,
      reconciliation: {
        parserEquivalentV4Tokens,
        databaseTokens: database.totalTokens,
        differenceTokens,
        differencePercent: database.totalTokens ? (differenceTokens / database.totalTokens) * 100 : 0,
        recordCount: database.recordCount,
        mirrorRecordCount: raw.methods.parserEquivalentV4UniqueRecordCount,
        matched: snapshotStable && differenceTokens === 0 && raw.methods.parserEquivalentV4UniqueRecordCount === database.recordCount,
      },
    };
  }
}

function sameSummary(left: SourceUsageSummary, right: SourceUsageSummary): boolean {
  return left.recordCount === right.recordCount && left.sessionCount === right.sessionCount &&
    JSON.stringify(left.usage) === JSON.stringify(right.usage);
}

export type { TokenUsage };
