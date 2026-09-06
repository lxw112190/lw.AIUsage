import { totalTokens, type TokenUsage } from "@lw-aiusage/core";
import type { SourceAuditRecord, SourceUsageSummary, UsageRepository } from "@lw-aiusage/storage";
import {
  auditCodexForkHistory,
  auditCodexPayloadUsageOverlap,
  auditCodexRaw,
  canonicalizeMirrorFiles,
  extractCodexFiles,
  replayCodexV4,
  snapshotCodexSource,
  stableHash,
  summarizeCodexExtractedEvents,
  type CodexEventTaxonomySummary,
  type CodexForkHistoryAudit,
  type CodexRawAuditReport,
  type CodexV4V5ComparisonReport,
  compareCodexV4V5,
  type ParserV4MirrorRecord,
  type PayloadUsageOverlapReport,
} from "@lw-aiusage/collectors";
import type { FileEntry, RuntimePlatform } from "@lw-aiusage/platform";

export interface CodexRecordMismatchSummary {
  mirrorOnly: number;
  databaseOnly: number;
  contentMismatch: number;
  mirrorOnlySamples: string[];
  databaseOnlySamples: string[];
}

interface RecordSetDiff {
  mirrorOnlyIds: Set<string>;
  databaseOnlyIds: Set<string>;
  contentMismatchIds: Set<string>;
}

export interface CodexRecordReconciliation {
  recordIdentityMatched: boolean;
  recordContentMatched: boolean;
  mirrorIdentityFingerprint: string;
  databaseIdentityFingerprint: string;
  mirrorContentFingerprint: string;
  databaseContentFingerprint: string;
  mismatches: CodexRecordMismatchSummary;
}

export interface CodexAccountingAuditReport {
  auditVersion: 3;
  auditRevision: 15;
  candidateAccountingRevision: 1;
  baselineParserVersion: 4;
  candidateParserVersion: 5;
  productionParserVersion: 4;
  /** @deprecated Use the explicit baseline/candidate/production version fields. */
  parserVersion: 4;
  accounting: "codex-accounting-audit-v3";
  generatedAt: number;
  snapshotStable: boolean;
  snapshot: {
    beforeFingerprint: string;
    afterFingerprint: string;
    sourceStable: boolean;
    databaseStable: boolean;
    auditStable: boolean;
  };
  raw: CodexRawAuditReport;
  eventTaxonomy: CodexEventTaxonomySummary;
  forkHistory: CodexForkHistoryAudit;
  payloadUsageOverlap: PayloadUsageOverlapReport;
  v5MigrationValidation: CodexV5MigrationValidation;
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
    recordIdentityMatched: boolean;
    recordContentMatched: boolean;
    mirrorIdentityFingerprint: string;
    databaseIdentityFingerprint: string;
    mirrorContentFingerprint: string;
    databaseContentFingerprint: string;
    mismatches: CodexRecordMismatchSummary;
    mirrorDiscoveredFileCount: number;
    mirrorCanonicalFileCount: number;
    mirrorShadowDuplicateCount: number;
    matched: boolean;
  };
}

export type CodexV5ComparisonSummary = Omit<CodexV4V5ComparisonReport, "comparisonEntries">;

export interface CodexV5MigrationValidation {
  comparison: CodexV5ComparisonSummary;
  sourceSnapshotStable: boolean;
  snapshotStable: boolean;
  comparisonComplete: boolean;
  productionSemanticsValidated: boolean;
  comparatorReady: boolean;
  readyForCollectorSwitch: boolean;
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
    const cursorByPath = new Map(cursors.filter((cursor) => cursor.source === "codex").map((cursor) => [cursor.path, cursor]));
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
          // A fresh session_meta identity is authoritative; old cursors can contain
          // a stale parent id after a fork or archive move.
          logicalId: file.logicalId ?? resolveCollectorLogicalId(cursorByPath.get(file.path), undefined),
        })),
      },
    );
    const mirror = replayCodexV4(extracted);
    const comparison = compareCodexV4V5(extracted, { detailLimit: 20 });
    const { comparisonEntries: _comparisonEntries, ...compactComparison } = comparison;
    const afterSnapshot = await snapshotCodexSource(this.platform);
    const database = await this.repository.getSourceUsageSummary("codex");
    const databaseRecords = await this.repository.getSourceAuditRecords("codex");
    const canonicalExtracted = canonicalizeMirrorFiles(extracted);
    const canonicalPaths = new Set(canonicalExtracted.map((file) => file.entry.path));
    const canonicalCursors = cursors.filter((cursor) => cursor.source === "codex" && canonicalPaths.has(cursor.path));
    const recordDiff = buildRecordSetDiff([...mirror.records.values()], databaseRecords);
    const eventTaxonomy = summarizeCodexExtractedEvents(canonicalExtracted);
    const forkHistory = auditCodexForkHistory(
      mirror.forkTraces,
      canonicalCursors,
      [...mirror.records.values()],
      recordDiff,
    );
    const payloadUsageOverlap = auditCodexPayloadUsageOverlap(extracted);
    const recordReconciliation = compareRecords([...mirror.records.values()], databaseRecords);
    const sourceSnapshotStable = beforeSnapshot.fingerprint === afterSnapshot.fingerprint;
    const databaseStable = sameSummary(databaseBefore, database);
    const auditStable = sourceSnapshotStable && databaseStable;
    const snapshotStable = auditStable;
    const v5MigrationValidation: CodexV5MigrationValidation = {
      comparison: compactComparison,
      sourceSnapshotStable,
      snapshotStable: sourceSnapshotStable,
      comparisonComplete: comparison.comparisonComplete,
      productionSemanticsValidated: comparison.productionSemantics.validated,
      comparatorReady: comparison.readyForCollectorSwitch,
      readyForCollectorSwitch: sourceSnapshotStable && comparison.readyForCollectorSwitch,
    };
    const mirrorTokens = totalTokens(mirror.usage);
    const differenceUsage = subtractUsage(mirror.usage, database.usage);
    const differenceTokens = mirrorTokens - database.totalTokens;
    const usageComponentsMatched = Object.values(differenceUsage).every((value) => value === 0);
    const tokenMatched = differenceTokens === 0;
    const recordCountMatched = mirror.recordCount === database.recordCount;
    const sessionCountMatched = mirror.sessionCount === database.sessionCount;
    return {
      auditVersion: 3,
      auditRevision: 15,
      candidateAccountingRevision: 1,
      baselineParserVersion: 4,
      candidateParserVersion: 5,
      productionParserVersion: 4,
      parserVersion: 4,
      accounting: "codex-accounting-audit-v3",
      generatedAt: Date.now(),
      snapshotStable,
      snapshot: {
        beforeFingerprint: beforeSnapshot.fingerprint,
        afterFingerprint: afterSnapshot.fingerprint,
        sourceStable: sourceSnapshotStable,
        databaseStable,
        auditStable,
      },
      raw,
      eventTaxonomy,
      forkHistory,
      payloadUsageOverlap,
      v5MigrationValidation,
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
        ...recordReconciliation,
        mirrorDiscoveredFileCount: mirror.discoveredFileCount,
        mirrorCanonicalFileCount: mirror.canonicalFileCount,
        mirrorShadowDuplicateCount: mirror.shadowDuplicateCount,
        matched: auditStable && tokenMatched && usageComponentsMatched && recordCountMatched && sessionCountMatched && recordReconciliation.recordIdentityMatched && recordReconciliation.recordContentMatched,
      },
    };
  }
}

export function resolveCollectorLogicalId(
  cursor: { logicalId?: string; parserState?: { sessionId?: string } } | undefined,
  snapshotLogicalId?: string,
): string | undefined {
  return cursor?.logicalId ?? cursor?.parserState?.sessionId ?? snapshotLogicalId;
}

function identitySignature(record: Pick<SourceAuditRecord | ParserV4MirrorRecord, "id" | "sessionId">): string {
  return JSON.stringify({ id: record.id, sessionId: record.sessionId ?? null });
}

function accountingSignature(record: Pick<SourceAuditRecord | ParserV4MirrorRecord, "id" | "sessionId" | "model" | "projectKey" | "usage">): string {
  return JSON.stringify({ id: record.id, sessionId: record.sessionId ?? null, model: record.model, projectKey: record.projectKey, usage: record.usage });
}

function signatureFingerprint(signatures: readonly string[]): string {
  return stableHash(signatures.join("\n"));
}

function buildRecordSetDiff(
  mirrorRecords: readonly ParserV4MirrorRecord[],
  databaseRecords: readonly SourceAuditRecord[],
): RecordSetDiff {
  const mirrorById = new Map(mirrorRecords.map((record) => [record.id, record]));
  const databaseById = new Map(databaseRecords.map((record) => [record.id, record]));
  const mirrorOnlyIds = new Set([...mirrorById.keys()].filter((id) => !databaseById.has(id)));
  const databaseOnlyIds = new Set([...databaseById.keys()].filter((id) => !mirrorById.has(id)));
  const contentMismatchIds = new Set([...mirrorById.keys()].filter((id) => {
    const left = mirrorById.get(id);
    const right = databaseById.get(id);
    return !!left && !!right && accountingSignature(left) !== accountingSignature(right);
  }));
  return { mirrorOnlyIds, databaseOnlyIds, contentMismatchIds };
}

export function compareRecords(
  mirrorRecords: readonly ParserV4MirrorRecord[],
  databaseRecords: readonly SourceAuditRecord[],
): CodexRecordReconciliation {
  const mirror = [...mirrorRecords].sort((left, right) => left.id.localeCompare(right.id));
  const database = [...databaseRecords].sort((left, right) => left.id.localeCompare(right.id));
  const mirrorIdentity = mirror.map(identitySignature);
  const databaseIdentity = database.map(identitySignature);
  const mirrorContent = mirror.map(accountingSignature);
  const databaseContent = database.map(accountingSignature);
  const recordDiff = buildRecordSetDiff(mirror, database);
  const recordIdentityMatched = mirror.length === database.length && mirrorIdentity.every((value, index) => value === databaseIdentity[index]);
  const recordContentMatched = mirror.length === database.length && mirrorContent.every((value, index) => value === databaseContent[index]);
  const mirrorOnly = [...recordDiff.mirrorOnlyIds];
  const databaseOnly = [...recordDiff.databaseOnlyIds];
  const contentMismatch = [...recordDiff.contentMismatchIds];
  return {
    recordIdentityMatched,
    recordContentMatched,
    mirrorIdentityFingerprint: signatureFingerprint(mirrorIdentity),
    databaseIdentityFingerprint: signatureFingerprint(databaseIdentity),
    mirrorContentFingerprint: signatureFingerprint(mirrorContent),
    databaseContentFingerprint: signatureFingerprint(databaseContent),
    mismatches: {
      mirrorOnly: mirrorOnly.length,
      databaseOnly: databaseOnly.length,
      contentMismatch: contentMismatch.length,
      mirrorOnlySamples: mirrorOnly.slice(0, 10).map(stableHash),
      databaseOnlySamples: databaseOnly.slice(0, 10).map(stableHash),
    },
  };
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
