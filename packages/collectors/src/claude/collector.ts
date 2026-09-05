import type { FileCursor } from "@lw-aiusage/storage";
import type { Collector, CollectorContext, CollectorDetection, CollectorFile, FileScanContext, FileScanResult } from "../types";
import { parseJsonl, readText } from "../shared/jsonl";
import { parseClaudeEvent } from "./parser";
import type { UnknownClaudeEvent } from "./types";

const isJsonl = (entry: { isFile: boolean; name: string }): boolean => entry.isFile && entry.name.toLowerCase().endsWith(".jsonl");
async function recursiveJsonl(fs: CollectorContext["platform"]["fs"], root: string): Promise<CollectorFile[]> {
  if (!(await fs.exists(root))) return [];
  const entries = await fs.list(root); const files: CollectorFile[] = [];
  for (const entry of entries) { if (isJsonl(entry)) files.push({ ...entry, source: "claude" }); else if (entry.isDirectory) files.push(...await recursiveJsonl(fs, entry.path)); }
  return files;
}
export class ClaudeCollector implements Collector {
  readonly source = "claude" as const;
  readonly name = "Claude Code";
  readonly parserVersion = 1;
  async roots(context: CollectorContext): Promise<string[]> { const home = await context.platform.paths.home(); return [`${home}/.claude/projects`]; }
  async detect(context: CollectorContext): Promise<CollectorDetection> { const roots = await this.roots(context); const installed = await context.platform.fs.exists(`${await context.platform.paths.home()}/.claude`); const files = (await Promise.all(roots.map((root) => recursiveJsonl(context.platform.fs, root)))).flat(); return { installed, dataAvailable: files.length > 0, roots }; }
  async discoverFiles(context: CollectorContext): Promise<CollectorFile[]> { return (await Promise.all((await this.roots(context)).map((root) => recursiveJsonl(context.platform.fs, root)))).flat(); }
  async scanFile(context: FileScanContext): Promise<FileScanResult> {
    const previous = context.cursor; const canResume = previous?.parserVersion === this.parserVersion && previous.offset <= context.file.size; const start = canResume ? previous.offset : 0;
    const buffer = await context.platform.fs.readRange(context.file.path, start); const parsed = context.parser ? await context.parser.parse(readText(buffer), canResume ? previous?.pendingText ?? "" : "") as { values: UnknownClaudeEvent[]; pendingText: string; errors: string[] } : parseJsonl<UnknownClaudeEvent>(readText(buffer), canResume ? previous?.pendingText ?? "" : "");
    let sessionId: string | undefined; let projectKey = context.file.path.split(/[\\/]/).at(-2) ?? "unknown"; let currentModel: string | undefined; const records = [];
    for (const [index, event] of parsed.values.entries()) { const result = parseClaudeEvent(event, { sessionId, projectKey, currentModel }, context.file.path, index + start); sessionId = result.sessionId ?? sessionId; projectKey = result.projectKey ?? projectKey; currentModel = result.model ?? currentModel; if (result.record) records.push(result.record); }
    return { records, diagnostics: parsed.errors, cursor: { key: `${this.source}:${context.file.path}`, source: this.source, path: context.file.path, offset: start + buffer.byteLength, size: context.file.size, modifiedAt: context.file.modifiedAt, pendingText: parsed.pendingText, parserVersion: this.parserVersion } };
  }
}
