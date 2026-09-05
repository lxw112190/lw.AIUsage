import { totalTokens, type TokenUsage } from "@lw-aiusage/core";
import type { UsageRepository, SourceUsageSummary } from "@lw-aiusage/storage";
import { auditCodexRaw, extractCodexFiles, replayCodexV4, snapshotCodexSource, type CodexRawAuditReport } from "@lw-aiusage/collectors";
import type { FileEntry, RuntimePlatform } from "@lw-aiusage/platform";

export interface CodexAccountingAuditReport {
  auditVersion: 3;
  auditRevision: 1;
  parserVersion: 4;
  accounting: "codex-accounting-audit-v3";
  generatedAt: number;
  snapshotStable: boolean;
  snapshot: { beforeFingerprint: string; afterFingerprint: string };
  raw: CodexRawAuditReport;
  database: SourceUsageSummary;
  reconciliation: {
    mirrorUsage: TokenUsage;
    databaseUsage: TokenUsage;
    differenceUsage: TokenUsage;
    mirrorTokens: number;
    parserEquivalentV4Tokens: number;
    databaseTokens: number;
    differenceTokens: number;
    differencePercent: number;
    recordCount: number;
    mirrorRecordCount: number;
    mirrorSessionCount: number;
    databaseSessionCount: number;
    tokenMatched: boolean;
    usageComponentsMatched: boolean;
    recordCountMatched: boolean;
    sessionCountMatched: boolean;
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
    const cursors = await this.repository.getCursors();
    const mirrorEntries: FileEntry[] = beforeSnapshot.files.map((file) => ({
      path: file.path,
      name: file.path.split(/[\\/]/).at(-1) ?? file.path,
      isFile: true,
      isDirectory: false,
      size: file.size,
      modifiedAt: file.modifiedAt,
    }));
    const extracted = await extractCodexFiles(
      this.platform,
      mirrorEntries,
      {
        files: beforeSnapshot.files.map((file) => ({
          ...file,
          logicalId: cursors.find((cursor) => cursor.source === "codex" && cursor.path === file.path)?.logicalId ?? file.logicalId,
        })),
      },
    );
    const mirror = replayCodexV4(extracted);
    const afterSnapshot = await snapshotCodexSource(this.platform);
    const database = await this.repository.getSourceUsageSummary("codex");
    const snapshotStable = beforeSnapshot.fingerprint === afterSnapshot.fingerprint && sameSummary(databaseBefore, database);
    const mirrorTokens = totalTokens(mirror.usage);
    const differenceUsage = subtractUsage(mirror.usage, database.usage);
    const differenceTokens = mirrorTokens - database.totalTokens;
    const usageComponentsMatched = Object.values(differenceUsage).every((value) => value === 0);
    const tokenMatched = differenceTokens === 0;
    const recordCountMatched = mirror.recordCount === database.recordCount;
    const sessionCountMatched = mirror.sessionCount === database.sessionCount;
    return {
      auditVersion: 3,
      auditRevision: 1,
      parserVersion: 4,
      accounting: "codex-accounting-audit-v3",
      generatedAt: Date.now(),
      snapshotStable,
      snapshot: { beforeFingerprint: beforeSnapshot.fingerprint, afterFingerprint: afterSnapshot.fingerprint },
      raw,
      database,
      reconciliation: {
        mirrorUsage: mirror.usage,
        databaseUsage: database.usage,
        differenceUsage,
        mirrorTokens,
        parserEquivalentV4Tokens: mirrorTokens,
        databaseTokens: database.totalTokens,
        differenceTokens,
        differencePercent: database.totalTokens ? (differenceTokens / database.totalTokens) * 100 : 0,
        recordCount: database.recordCount,
        mirrorRecordCount: mirror.recordCount,
        mirrorSessionCount: mirror.sessionCount,
        databaseSessionCount: database.sessionCount,
        tokenMatched,
        usageComponentsMatched,
        recordCountMatched,
        sessionCountMatched,
        matched: snapshotStable && tokenMatched && usageComponentsMatched && recordCountMatched && sessionCountMatched,
      },
    };
  }
}

function sameSummary(left: SourceUsageSummary, right: SourceUsageSummary): boolean {
  return left.recordCount === right.recordCount && left.sessionCount === right.sessionCount &&
    JSON.stringify(left.usage) === JSON.stringify(right.usage);
}

function subtractUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens - right.inputTokens,
    cachedInputTokens: left.cachedInputTokens - right.cachedInputTokens,
    cacheCreationInputTokens: left.cacheCreationInputTokens - right.cacheCreationInputTokens,
    outputTokens: left.outputTokens - right.outputTokens,
    reasoningOutputTokens: left.reasoningOutputTokens - right.reasoningOutputTokens,
  };
}

export type { TokenUsage };
