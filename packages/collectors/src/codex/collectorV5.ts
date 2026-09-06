import type {
  CollectorContext,
  CollectorDetection,
  CollectorFile,
  SourceCollector,
  SourceScanContext,
  SourceScanResult,
} from "../types";
import { parseJsonl } from "../shared/jsonl";
import { objectValue, stringValue } from "../shared/identity";
import { parseCodexFilesV5 } from "./parserV5";
import type { UnknownCodexEvent } from "./types";
import { readCodexSourceFilesV5 } from "./sourceReaderV5";

const META_PEEK_BYTES = 64 * 1024;
const isJsonl = (entry: { isFile: boolean; name: string }): boolean => entry.isFile && entry.name.toLowerCase().endsWith(".jsonl");

async function readRawSessionMeta(
  context: CollectorContext,
  file: CollectorFile,
): Promise<{ sessionId?: string; forkedFromId?: string }> {
  if (file.size <= 0) return {};
  const bytes = await context.platform.fs.readRange(file.path, 0, Math.min(file.size, META_PEEK_BYTES));
  const parsed = parseJsonl<UnknownCodexEvent>(new TextDecoder().decode(bytes), "");
  for (const event of parsed.values) {
    if (event.type !== "session_meta") continue;
    const payload = objectValue(event.payload) ?? event;
    return {
      sessionId: stringValue(payload.id) ?? stringValue(payload.session_id) ?? stringValue(payload.sessionId),
      forkedFromId: stringValue(payload.forked_from_id) ?? stringValue(payload.forkedFromId),
    };
  }
  return {};
}

async function recursiveJsonl(
  context: CollectorContext,
  root: string,
): Promise<CollectorFile[]> {
  if (!(await context.platform.fs.exists(root))) return [];
  const files: CollectorFile[] = [];
  for (const entry of await context.platform.fs.list(root)) {
    if (isJsonl(entry)) files.push({ ...entry, source: "codex" });
    else if (entry.isDirectory) files.push(...(await recursiveJsonl(context, entry.path)));
  }
  return files;
}

export function sameCodexSourceSnapshotV5(
  left: readonly CollectorFile[],
  right: readonly CollectorFile[],
): boolean {
  const normalize = (files: readonly CollectorFile[]) => [...files]
    .map((file) => ({ path: file.path, logicalId: file.logicalId, size: file.size, modifiedAt: file.modifiedAt }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

const diagnosticsOf = (parsed: ReturnType<typeof parseCodexFilesV5>): string[] => {
  const diagnostics: string[] = [];
  if (parsed.diagnostics.source.parseErrorCount > 0) diagnostics.push(`CODEX_V5_PARSE_ERRORS:${parsed.diagnostics.source.parseErrorCount}`);
  if (parsed.diagnostics.source.filesWithPendingText > 0) diagnostics.push(`CODEX_V5_PENDING_FILES:${parsed.diagnostics.source.filesWithPendingText}`);
  if (parsed.diagnostics.reconcile.conflictingLogicalSessions > 0) diagnostics.push(`CODEX_V5_LOGICAL_CONFLICTS:${parsed.diagnostics.reconcile.conflictingLogicalSessions}`);
  if (parsed.diagnostics.reconcile.orphanFiles > 0) diagnostics.push(`CODEX_V5_ORPHAN_FILES:${parsed.diagnostics.reconcile.orphanFiles}`);
  if (parsed.diagnostics.tokenCount.methods.unresolved > 0) diagnostics.push(`CODEX_V5_UNRESOLVED_TOKEN_COUNTS:${parsed.diagnostics.tokenCount.methods.unresolved}`);
  if (parsed.diagnostics.projection.missingTimestampContributions > 0) diagnostics.push(`CODEX_V5_MISSING_TIMESTAMPS:${parsed.diagnostics.projection.missingTimestampContributions}`);
  if (!parsed.safeToActivate && diagnostics.length === 0) diagnostics.push("CODEX_V5_UNSAFE");
  return diagnostics;
};

export class CodexCollectorV5 implements SourceCollector {
  readonly source = "codex" as const;
  readonly name = "Codex";
  readonly parserVersion = 5;
  readonly scanMode = "source" as const;

  async roots(context: CollectorContext): Promise<string[]> {
    const home = await context.platform.paths.home();
    return [`${home}/.codex/sessions`, `${home}/.codex/archived_sessions`];
  }

  async detect(context: CollectorContext): Promise<CollectorDetection> {
    const roots = await this.roots(context);
    const installed = await context.platform.fs.exists(`${await context.platform.paths.home()}/.codex`);
    const files = (await Promise.all(roots.map((root) => recursiveJsonl(context, root)))).flat();
    return { installed, dataAvailable: files.length > 0, roots };
  }

  async discoverFiles(context: CollectorContext): Promise<CollectorFile[]> {
    const files = (await Promise.all((await this.roots(context)).map((root) => recursiveJsonl(context, root)))).flat()
      .sort((left, right) => left.path.localeCompare(right.path));
    const result: CollectorFile[] = [];
    for (const file of files) {
      const meta = await readRawSessionMeta(context, file);
      result.push({ ...file, ...(meta.sessionId ? { logicalId: meta.sessionId } : {}) });
    }
    return result;
  }

  async scanSource(context: SourceScanContext): Promise<SourceScanResult> {
    const inputs = await readCodexSourceFilesV5(context, context.files);
    const parsed = parseCodexFilesV5(inputs);
    const diagnostics = diagnosticsOf(parsed);
    const afterFiles = await this.discoverFiles({ platform: context.platform, onProgress: context.onProgress });
    if (!sameCodexSourceSnapshotV5(context.files, afterFiles)) {
      diagnostics.push("CODEX_V5_SOURCE_CHANGED_DURING_SCAN");
      return { records: [], cursors: [], diagnostics, safeToCommit: false };
    }
    if (!parsed.safeToActivate) return { records: [], cursors: [], diagnostics, safeToCommit: false };
    return {
      records: parsed.records,
      cursors: context.files.map((file) => ({
        key: `${this.source}:${file.path}`,
        source: this.source,
        path: file.path,
        logicalId: file.logicalId,
        offset: file.size,
        size: file.size,
        modifiedAt: file.modifiedAt,
        pendingText: "",
        parserVersion: this.parserVersion,
      })),
      diagnostics,
      safeToCommit: true,
    };
  }
}
