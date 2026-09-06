import type { CodexAccountingEvent } from "./accountingV5";
import type { CodexDecodedFileV5 } from "./eventDecoderV5";

export interface CodexLogicalSessionV5 {
  sessionId: string;
  parentSessionId?: string;
  forkTimestamp?: number;
  sourcePath: string;
  events: readonly CodexAccountingEvent[];
  shadowedSourcePaths: readonly string[];
}

export type CodexLogicalSessionConflictReason = "divergent-events" | "metadata-conflict";

export interface CodexLogicalSessionConflictV5 {
  sessionId: string;
  reason: CodexLogicalSessionConflictReason;
  sourcePaths: string[];
  files: CodexDecodedFileV5[];
}

/** Safe-to-export conflict evidence without decoded event payloads. */
export type CodexLogicalSessionConflictSummaryV5 = Pick<
  CodexLogicalSessionConflictV5,
  "sessionId" | "reason" | "sourcePaths"
>;

export interface CodexLogicalSessionReconcileDiagnosticsV5 {
  decodedFiles: number;
  logicalSessions: number;
  exactDuplicateFiles: number;
  prefixShadowedFiles: number;
  conflictingLogicalSessions: number;
  orphanFiles: number;
  conflicts: CodexLogicalSessionConflictSummaryV5[];
}

export interface CodexLogicalSessionReconcileResultV5 {
  sessions: CodexLogicalSessionV5[];
  conflicts: CodexLogicalSessionConflictV5[];
  orphanFiles: CodexDecodedFileV5[];
  diagnostics: CodexLogicalSessionReconcileDiagnosticsV5;
}

const pathKey = (path: string): string => path.replace(/\\/g, "/").toLowerCase();

const isArchivedPath = (path: string): boolean =>
  pathKey(path).split("/").includes("archived_sessions");

const representativeFile = (files: readonly CodexDecodedFileV5[]): CodexDecodedFileV5 =>
  [...files].sort((left, right) =>
    Number(isArchivedPath(left.sourcePath)) - Number(isArchivedPath(right.sourcePath)) ||
    left.sourcePath.localeCompare(right.sourcePath)).at(0)!;

const rawIdentitySequence = (file: CodexDecodedFileV5): string[] =>
  [...file.events].sort((left, right) => left.eventIndex - right.eventIndex || left.rawIdentity.localeCompare(right.rawIdentity)).map((event) => event.rawIdentity);

const isPrefix = (shorter: readonly string[], longer: readonly string[]): boolean =>
  shorter.length <= longer.length && shorter.every((value, index) => value === longer[index]);

const metadataCompatible = (left: CodexDecodedFileV5, right: CodexDecodedFileV5): boolean =>
  left.parentSessionId === right.parentSessionId &&
  (left.forkTimestamp === undefined || right.forkTimestamp === undefined || left.forkTimestamp === right.forkTimestamp);

const sourcePathOrder = (left: string, right: string): number =>
  Number(isArchivedPath(left)) - Number(isArchivedPath(right)) || left.localeCompare(right);

export function reconcileCodexLogicalSessionsV5(
  files: readonly CodexDecodedFileV5[],
): CodexLogicalSessionReconcileResultV5 {
  const groups = new Map<string, CodexDecodedFileV5[]>();
  const orphanFiles: CodexDecodedFileV5[] = [];
  for (const file of files) {
    const sessionId = file.sessionId ?? file.logicalIdHint;
    if (!sessionId) {
      orphanFiles.push(file);
      continue;
    }
    const group = groups.get(sessionId) ?? [];
    group.push(file);
    groups.set(sessionId, group);
  }

  const sessions: CodexLogicalSessionV5[] = [];
  const conflicts: CodexLogicalSessionConflictV5[] = [];
  let exactDuplicateFiles = 0;
  let prefixShadowedFiles = 0;
  for (const sessionId of [...groups.keys()].sort()) {
    const group = [...groups.get(sessionId)!].sort((left, right) => sourcePathOrder(left.sourcePath, right.sourcePath));
    const base = group[0]!;
    const baseSequence = rawIdentitySequence(base);
    const metadataConflict = group.some((file) => !metadataCompatible(base, file));
    let representative = base;
    let shadowedSourcePaths: string[] = [];
    if (metadataConflict) {
      conflicts.push({
        sessionId,
        reason: "metadata-conflict",
        sourcePaths: group.map((file) => file.sourcePath).sort(sourcePathOrder),
        files: group,
      });
      continue;
    }
    const sequences = group.map((file) => ({ file, sequence: rawIdentitySequence(file) }));
    const allExact = sequences.every(({ sequence }) => sequence.length === baseSequence.length && isPrefix(sequence, baseSequence));
    if (allExact) {
      representative = representativeFile(group);
      exactDuplicateFiles += Math.max(group.length - 1, 0);
      shadowedSourcePaths = group.filter((file) => file !== representative).map((file) => file.sourcePath).sort(sourcePathOrder);
    } else {
      const longest = sequences.reduce((current, candidate) => candidate.sequence.length > current.sequence.length ? candidate : current, sequences[0]!);
      const allPrefixCompatible = sequences.every(({ sequence }) => isPrefix(sequence, longest.sequence));
      if (allPrefixCompatible) {
        representative = longest.file;
        shadowedSourcePaths = group.filter((file) => file !== representative).map((file) => file.sourcePath).sort(sourcePathOrder);
        prefixShadowedFiles += shadowedSourcePaths.length;
      } else {
        conflicts.push({
          sessionId,
          reason: "divergent-events",
          sourcePaths: group.map((file) => file.sourcePath).sort(sourcePathOrder),
          files: group,
        });
        continue;
      }
    }
    sessions.push({
      sessionId,
      parentSessionId: representative.parentSessionId,
      forkTimestamp: representative.forkTimestamp,
      sourcePath: representative.sourcePath,
      events: representative.events,
      shadowedSourcePaths,
    });
  }
  return {
    sessions,
    conflicts,
    orphanFiles: orphanFiles.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
    diagnostics: {
      decodedFiles: files.length,
      logicalSessions: sessions.length,
      exactDuplicateFiles,
      prefixShadowedFiles,
      conflictingLogicalSessions: conflicts.length,
      orphanFiles: orphanFiles.length,
      conflicts: conflicts.map(({ sessionId, reason, sourcePaths }) => ({
        sessionId,
        reason,
        sourcePaths: [...sourcePaths],
      })),
    },
  };
}
