import type { AgentSource, UsageRecord } from "@lw-aiusage/core";
import type { FileEntry, RuntimePlatform } from "@lw-aiusage/platform";
import type { FileCursor } from "@lw-aiusage/storage";

export interface CollectorContext {
  platform: RuntimePlatform;
  cursor?: FileCursor;
  cursors?: readonly FileCursor[];
  parser?: JsonlParserPort;
  onProgress?: (progress: CollectorProgress) => void;
}
export interface JsonlParserPort {
  parse(
    text: string,
    pendingText: string,
  ): Promise<{ values: unknown[]; pendingText: string; errors: string[] }>;
}
export interface CollectorProgress {
  source: AgentSource;
  current: number;
  total: number;
  path?: string;
}
export interface CollectorDetection {
  installed: boolean;
  dataAvailable: boolean;
  roots: string[];
}
export interface CollectorFile extends FileEntry {
  source: AgentSource;
  /** Stable logical identity independent of the current filesystem path. */
  logicalId?: string;
}
export type FileReconcileMode = "path" | "logical-singleton";
export interface FileScanContext extends CollectorContext {
  file: CollectorFile;
}
export interface FileScanResult {
  records: UsageRecord[];
  cursor: FileCursor;
  diagnostics: string[];
  replaceRecords?: boolean;
}
export interface FileCollector extends CollectorBase {
  readonly scanMode: "file";
  readonly fileReconcileMode: FileReconcileMode;
  scanFile(context: FileScanContext): Promise<FileScanResult>;
}
export interface SourceScanContext extends CollectorContext {
  files: readonly CollectorFile[];
  cursors: readonly FileCursor[];
}
export interface SourceScanResult {
  records: UsageRecord[];
  cursors: FileCursor[];
  diagnostics: string[];
  safeToCommit: boolean;
}
export interface SourceCollector extends CollectorBase {
  readonly scanMode: "source";
  scanSource(context: SourceScanContext): Promise<SourceScanResult>;
}
export interface CollectorBase {
  readonly source: AgentSource;
  readonly name: string;
  readonly parserVersion: number;
  /** Validation policy revision for the committed source snapshot. */
  readonly scanRevision?: number;
  detect(context: CollectorContext): Promise<CollectorDetection>;
  roots(context: CollectorContext): Promise<string[]>;
  discoverFiles(context: CollectorContext): Promise<CollectorFile[]>;
}
export type Collector = FileCollector | SourceCollector;
