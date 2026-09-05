import type { FileCursor } from "@lw-aiusage/storage";
import type { TokenUsage } from "@lw-aiusage/core";
import type {
  Collector,
  CollectorContext,
  CollectorDetection,
  CollectorFile,
  FileScanContext,
  FileScanResult,
} from "../types";
import { parseJsonl, readText } from "../shared/jsonl";
import { parseCodexEvent } from "./parser";
import type { CodexParseContext, UnknownCodexEvent } from "./types";

const isJsonl = (entry: { isFile: boolean; name: string }): boolean =>
  entry.isFile && entry.name.toLowerCase().endsWith(".jsonl");
async function recursiveJsonl(
  fs: CollectorContext["platform"]["fs"],
  root: string,
): Promise<CollectorFile[]> {
  if (!(await fs.exists(root))) return [];
  const entries = await fs.list(root);
  const files: CollectorFile[] = [];
  for (const entry of entries) {
    if (isJsonl(entry)) files.push({ ...entry, source: "codex" });
    else if (entry.isDirectory)
      files.push(...(await recursiveJsonl(fs, entry.path)));
  }
  return files;
}

export class CodexCollector implements Collector {
  readonly source = "codex" as const;
  readonly name = "Codex";
  readonly parserVersion = 3;
  private readonly sessionTotals = new Map<string, TokenUsage>();
  async roots(context: CollectorContext): Promise<string[]> {
    const home = await context.platform.paths.home();
    return [`${home}/.codex/sessions`, `${home}/.codex/archived_sessions`];
  }
  async detect(context: CollectorContext): Promise<CollectorDetection> {
    const roots = await this.roots(context);
    const installed = await context.platform.fs.exists(
      `${await context.platform.paths.home()}/.codex`,
    );
    const files = (
      await Promise.all(
        roots.map((root) => recursiveJsonl(context.platform.fs, root)),
      )
    ).flat();
    return { installed, dataAvailable: files.length > 0, roots };
  }
  async discoverFiles(context: CollectorContext): Promise<CollectorFile[]> {
    for (const cursor of context.cursors ?? []) {
      const sessionId = cursor.parserState?.sessionId;
      const totalUsage = cursor.parserState?.previousTotalUsage;
      if (sessionId && totalUsage) this.sessionTotals.set(sessionId, { ...totalUsage });
    }
    return (
      await Promise.all(
        (await this.roots(context)).map((root) =>
          recursiveJsonl(context.platform.fs, root),
        ),
      )
    ).flat().sort((left, right) => left.path.localeCompare(right.path));
  }

  async scanFile(context: FileScanContext): Promise<FileScanResult> {
    const previous = context.cursor;
    if (
      previous &&
      previous.parserVersion === this.parserVersion &&
      previous.size === context.file.size &&
      previous.modifiedAt === context.file.modifiedAt
    )
      return { records: [], diagnostics: [], cursor: previous };
    const canResume =
      previous?.parserVersion === this.parserVersion &&
      previous.offset < context.file.size;
    const start = canResume ? previous.offset : 0;
    const buffer = await context.platform.fs.readRange(
      context.file.path,
      start,
    );
    const parsed = context.parser
      ? ((await context.parser.parse(
          readText(buffer),
          canResume ? (previous?.pendingText ?? "") : "",
        )) as {
          values: UnknownCodexEvent[];
          pendingText: string;
          errors: string[];
        })
      : parseJsonl<UnknownCodexEvent>(
          readText(buffer),
          canResume ? (previous?.pendingText ?? "") : "",
        );
    let state: CodexParseContext = canResume && previous?.parserState
      ? {
          ...previous.parserState,
          projectKey: previous.parserState.projectKey ?? "unknown",
        } as CodexParseContext
      : { projectKey: "unknown" };
    const records = [];
    for (const [index, event] of parsed.values.entries()) {
      if (state.forkedFromSessionId && !state.forkBaselineUsage) state.forkBaselineUsage = this.sessionTotals.get(state.forkedFromSessionId);
      const result = parseCodexEvent(
        event,
        state,
        context.file.path,
        index + start,
      );
      state = result.state;
      if (state.forkedFromSessionId && !state.forkBaselineUsage) state.forkBaselineUsage = this.sessionTotals.get(state.forkedFromSessionId);
      if (state.sessionId && state.previousTotalUsage) this.sessionTotals.set(state.sessionId, { ...state.previousTotalUsage });
      if (result.record) records.push(result.record);
    }
    return {
      records,
      diagnostics: parsed.errors,
      replaceRecords: !!previous && start === 0,
      cursor: {
        key: `${this.source}:${context.file.path}`,
        source: this.source,
        path: context.file.path,
        offset: start + buffer.byteLength,
        size: context.file.size,
        modifiedAt: context.file.modifiedAt,
        pendingText: parsed.pendingText,
        parserVersion: this.parserVersion,
        parserState: state,
      },
    };
  }
}
