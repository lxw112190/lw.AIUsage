import { logicalSessionKey, type AgentSource } from "@lw-aiusage/core";
import type { CollectorFile, FileReconcileMode } from "@lw-aiusage/collectors";
import type { FileCursor, UsageRepository } from "@lw-aiusage/storage";

export interface ReconciledFile {
  file: CollectorFile;
  cursor?: FileCursor;
  migrated: boolean;
  shadowDuplicate?: boolean;
  forceScan?: boolean;
}

const cursorLogicalId = (cursor: FileCursor): string | undefined => cursor.logicalId ?? cursor.parserState?.sessionId;
const isArchived = (path: string): boolean => /[\\/]archived_sessions[\\/]/i.test(path);

function preferredFile(left: CollectorFile, right: CollectorFile): CollectorFile {
  if (left.size !== right.size) return left.size > right.size ? left : right;
  if (left.modifiedAt !== right.modifiedAt) return left.modifiedAt > right.modifiedAt ? left : right;
  if (isArchived(left.path) !== isArchived(right.path)) return isArchived(left.path) ? left : right;
  return left.path.localeCompare(right.path) <= 0 ? left : right;
}

export function reconcileCollectorFiles(
  repository: UsageRepository,
  source: AgentSource,
  mode: FileReconcileMode,
  files: readonly CollectorFile[],
  cursors: readonly FileCursor[],
): Promise<ReconciledFile[]>;
export function reconcileCollectorFiles(
  repository: UsageRepository,
  source: AgentSource,
  files: readonly CollectorFile[],
  cursors: readonly FileCursor[],
): Promise<ReconciledFile[]>;
export async function reconcileCollectorFiles(
  repository: UsageRepository,
  source: AgentSource,
  modeOrFiles: FileReconcileMode | readonly CollectorFile[],
  filesOrCursors: readonly CollectorFile[] | readonly FileCursor[],
  maybeCursors?: readonly FileCursor[],
): Promise<ReconciledFile[]> {
  const mode: FileReconcileMode = typeof modeOrFiles === "string" ? modeOrFiles : "logical-singleton";
  const files = (typeof modeOrFiles === "string" ? filesOrCursors : modeOrFiles) as readonly CollectorFile[];
  const cursors = (typeof modeOrFiles === "string" ? maybeCursors : filesOrCursors) as readonly FileCursor[];
  const cursorByPath = new Map(cursors.filter((cursor) => cursor.source === source).map((cursor) => [cursor.path, cursor]));
  const cursorByLogicalId = new Map<string, FileCursor>();
  if (mode === "logical-singleton")
    for (const cursor of cursorByPath.values()) {
      const logicalId = cursorLogicalId(cursor);
      if (logicalId)
        cursorByLogicalId.set(logicalSessionKey(source, logicalId), cursor);
    }
  const winnerByLogicalId = new Map<string, CollectorFile>();
  for (const file of files) {
    if (!file.logicalId) continue;
    const key = logicalSessionKey(source, file.logicalId);
    const current = winnerByLogicalId.get(key);
    if (!current) winnerByLogicalId.set(key, file);
    else winnerByLogicalId.set(key, preferredFile(current, file));
  }

  const migratedCursorKeys = new Set<string>();
  const result: ReconciledFile[] = [];
  for (const file of files) {
    const winner = mode === "logical-singleton" && file.logicalId
      ? winnerByLogicalId.get(logicalSessionKey(source, file.logicalId))
      : undefined;
    if (winner && winner.path !== file.path) {
      result.push({ file, migrated: false, shadowDuplicate: true });
      continue;
    }
    let cursor = cursorByPath.get(file.path);
    let migrated = false;
    let forceScan = false;
    const currentLogicalId = cursor ? cursorLogicalId(cursor) : undefined;
    if (cursor && file.logicalId && currentLogicalId && currentLogicalId !== file.logicalId) {
      cursor = { ...cursor, logicalId: file.logicalId, offset: 0, pendingText: "", parserState: undefined };
      forceScan = true;
    } else if (!cursor && file.logicalId) {
      const oldCursor = cursorByLogicalId.get(logicalSessionKey(source, file.logicalId));
      if (oldCursor && oldCursor.path !== file.path && !migratedCursorKeys.has(oldCursor.key)) {
        cursor = await repository.migrateFileCursor(oldCursor, file);
        migratedCursorKeys.add(oldCursor.key);
        migrated = true;
      }
    }
    if (cursor && file.logicalId && cursor.logicalId !== file.logicalId) {
      cursor = { ...cursor, logicalId: file.logicalId };
      await repository.putCursor(cursor);
    }
    result.push({ file, cursor, migrated, forceScan });
  }
  return result;
}
