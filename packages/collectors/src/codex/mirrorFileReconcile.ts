import type { CodexExtractedFile } from "./rawAuditTypes";

const isArchived = (path: string): boolean =>
  /[\\/]archived_sessions[\\/]/i.test(path);

function preferredFile(
  left: CodexExtractedFile,
  right: CodexExtractedFile,
): CodexExtractedFile {
  if (left.entry.size !== right.entry.size)
    return left.entry.size > right.entry.size ? left : right;
  if (left.entry.modifiedAt !== right.entry.modifiedAt)
    return left.entry.modifiedAt > right.entry.modifiedAt ? left : right;
  if (isArchived(left.entry.path) !== isArchived(right.entry.path))
    return isArchived(left.entry.path) ? left : right;
  return left.entry.path.localeCompare(right.entry.path) <= 0 ? left : right;
}

export function canonicalizeMirrorFiles(
  files: readonly CodexExtractedFile[],
): CodexExtractedFile[] {
  const winnerByLogicalId = new Map<string, CodexExtractedFile>();
  for (const file of files) {
    if (!file.peekLogicalId) continue;
    const current = winnerByLogicalId.get(file.peekLogicalId);
    winnerByLogicalId.set(
      file.peekLogicalId,
      current ? preferredFile(current, file) : file,
    );
  }
  return files.filter((file) => {
    if (!file.peekLogicalId) return true;
    return winnerByLogicalId.get(file.peekLogicalId)?.entry.path === file.entry.path;
  });
}
