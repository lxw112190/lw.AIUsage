import type { AgentSource, UsageRecord } from "@lw-aiusage/core";
import type { FileEntry, RuntimePlatform } from "@lw-aiusage/platform";
import type { FileCursor } from "@lw-aiusage/storage";

export interface CollectorContext { platform: RuntimePlatform; cursor?: FileCursor; parser?: JsonlParserPort; onProgress?: (progress: CollectorProgress) => void; }
export interface JsonlParserPort { parse(text: string, pendingText: string): Promise<{ values: unknown[]; pendingText: string; errors: string[] }>; }
export interface CollectorProgress { source: AgentSource; current: number; total: number; path?: string; }
export interface CollectorDetection { installed: boolean; dataAvailable: boolean; roots: string[]; }
export interface CollectorFile extends FileEntry { source: AgentSource; }
export interface FileScanContext extends CollectorContext { file: CollectorFile; }
export interface FileScanResult { records: UsageRecord[]; cursor: FileCursor; diagnostics: string[]; }
export interface Collector { readonly source: AgentSource; readonly name: string; readonly parserVersion: number; detect(context: CollectorContext): Promise<CollectorDetection>; discoverFiles(context: CollectorContext): Promise<CollectorFile[]>; scanFile(context: FileScanContext): Promise<FileScanResult>; }
