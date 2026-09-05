import type {
  Collector,
  CollectorContext,
  CollectorDetection,
  CollectorFile,
  FileScanContext,
  FileScanResult,
} from "../types";
import { parseJsonl, readText } from "../shared/jsonl";
import { objectValue, stringValue } from "../shared/identity";
import { parseClaudeEvent } from "./parser";
import type { ClaudeParseContext, UnknownClaudeEvent } from "./types";

const isJsonl = (entry: { isFile: boolean; name: string }): boolean =>
  entry.isFile && entry.name.toLowerCase().endsWith(".jsonl");
const META_PEEK_BYTES = 64 * 1024;

async function readClaudeSessionId(
  platform: CollectorContext["platform"],
  file: CollectorFile,
): Promise<string | undefined> {
  if (file.size <= 0) return undefined;
  const bytes = await platform.fs.readRange(file.path, 0, Math.min(file.size, META_PEEK_BYTES));
  const parsed = parseJsonl<UnknownClaudeEvent>(readText(bytes), "");
  for (const event of parsed.values) {
    const sessionId = stringValue(event.sessionId) ?? stringValue(event.session_id);
    if (sessionId) return sessionId;
    const message = objectValue(event.message);
    const messageSessionId = stringValue(message?.sessionId) ?? stringValue(message?.session_id);
    if (messageSessionId) return messageSessionId;
  }
  return undefined;
}
async function recursiveJsonl(
  fs: CollectorContext["platform"]["fs"],
  root: string,
): Promise<CollectorFile[]> {
  if (!(await fs.exists(root))) return [];
  const entries = await fs.list(root);
  const files: CollectorFile[] = [];
  for (const entry of entries) {
    if (isJsonl(entry)) files.push({ ...entry, source: "claude" });
    else if (entry.isDirectory)
      files.push(...(await recursiveJsonl(fs, entry.path)));
  }
  return files;
}
export class ClaudeCollector implements Collector {
  readonly source = "claude" as const;
  readonly name = "Claude Code";
  readonly parserVersion = 4;
  readonly fileReconcileMode = "path" as const;
  async roots(context: CollectorContext): Promise<string[]> {
    const home = await context.platform.paths.home();
    return [`${home}/.claude/projects`];
  }
  async detect(context: CollectorContext): Promise<CollectorDetection> {
    const roots = await this.roots(context);
    const installed = await context.platform.fs.exists(
      `${await context.platform.paths.home()}/.claude`,
    );
    const files = (
      await Promise.all(
        roots.map((root) => recursiveJsonl(context.platform.fs, root)),
      )
    ).flat().sort((left, right) => left.path.localeCompare(right.path));
    return { installed, dataAvailable: files.length > 0, roots };
  }
  async discoverFiles(context: CollectorContext): Promise<CollectorFile[]> {
    const files = (
      await Promise.all(
        (await this.roots(context)).map((root) =>
          recursiveJsonl(context.platform.fs, root),
        ),
      )
    ).flat();
    const result: CollectorFile[] = [];
    for (const file of files) {
      const cursor = context.cursors?.find((item) => item.source === this.source && item.path === file.path);
      const logicalId = cursor?.logicalId ?? cursor?.parserState?.sessionId ?? (await readClaudeSessionId(context.platform, file));
      result.push(logicalId ? { ...file, logicalId } : file);
    }
    return result;
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
          values: UnknownClaudeEvent[];
          pendingText: string;
          errors: string[];
        })
      : parseJsonl<UnknownClaudeEvent>(
          readText(buffer),
          canResume ? (previous?.pendingText ?? "") : "",
        );
    let state: ClaudeParseContext = canResume && previous?.parserState
      ? {
          ...previous.parserState,
          projectKey:
            previous.parserState.projectKey ??
            context.file.path.split(/[\\/]/).at(-2) ??
            "unknown",
        } as ClaudeParseContext
      : { projectKey: context.file.path.split(/[\\/]/).at(-2) ?? "unknown" };
    const records = [];
    for (const [index, event] of parsed.values.entries()) {
      const result = parseClaudeEvent(
        event,
        state,
        context.file.path,
        index + start,
        context.file.logicalId,
      );
      state = result.state;
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
        logicalId: context.file.logicalId ?? state.sessionId,
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
