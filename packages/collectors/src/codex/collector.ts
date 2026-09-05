import type { FileCursor } from "@lw-aiusage/storage";
import type { Collector, CollectorContext, CollectorDetection, CollectorFile, FileScanContext, FileScanResult } from "../types";
import { parseJsonl, readText } from "../shared/jsonl";
import { parseCodexEvent } from "./parser";
import type { UnknownCodexEvent } from "./types";

const isJsonl = (entry: { isFile: boolean; name: string }): boolean => entry.isFile && entry.name.toLowerCase().endsWith(".jsonl");
async function recursiveJsonl(fs: CollectorContext["platform"]["fs"], root: string): Promise<CollectorFile[]> {
  if (!(await fs.exists(root))) return [];
  const entries = await fs.list(root);
  const files: CollectorFile[] = [];
  for (const entry of entries) {
    if (isJsonl(entry)) files.push({ ...entry, source: "codex" });
    else if (entry.isDirectory) files.push(...await recursiveJsonl(fs, entry.path));
  }
  return files;
}
export class CodexCollector implements Collector {
  readonly source = "codex" as const;
  readonly name = "Codex";
  readonly parserVersion = 1;
  async roots(context: CollectorContext): Promise<string[]> { const home = await context.platform.paths.home(); return [`${home}/.codex/sessions`, `${home}/.codex/archived_sessions`]; }
  async detect(context: CollectorContext): Promise<CollectorDetection> { const roots = await this.roots(context); const installed = await context.platform.fs.exists(`${await context.platform.paths.home()}/.codex`); const files = (await Promise.all(roots.map((root) => recursiveJsonl(context.platform.fs, root)))).flat(); return { installed, dataAvailable: files.length > 0, roots }; }
  async discoverFiles(context: CollectorContext): Promise<CollectorFile[]> { return (await Promise.all((await this.roots(context)).map((root) => recursiveJsonl(context.platform.fs, root)))).flat(); }
  async scanFile(context: FileScanContext): Promise<FileScanResult> {
    const previous = context.cursor;
    const canResume = previous?.parserVersion === this.parserVersion && previous.offset <= context.file.size;
    const start = canResume ? previous.offset : 0;
    const buffer = await context.platform.fs.readRange(context.file.path, start);
    const parsed = context.parser ? await context.parser.parse(readText(buffer), canResume ? previous?.pendingText ?? "" : "") as { values: UnknownCodexEvent[]; pendingText: string; errors: string[] } : parseJsonl<UnknownCodexEvent>(readText(buffer), canResume ? previous?.pendingText ?? "" : "");
    let sessionId = previous?.key.split(":").slice(1, -1).join(":") || undefined;
    let projectKey = "unknown";
    let currentModel: string | undefined;
    const records = [];
    for (const [index, event] of parsed.values.entries()) {
      const result = parseCodexEvent(event, { sessionId, projectKey, currentModel }, context.file.path, index + start);
      sessionId = result.sessionId ?? sessionId;
      projectKey = result.projectKey ?? projectKey;
      currentModel = result.model ?? currentModel;
      if (result.record) records.push(result.record);
    }
    const nextOffset = start + buffer.byteLength;
    return { records, diagnostics: parsed.errors, cursor: { key: `${this.source}:${context.file.path}`, source: this.source, path: context.file.path, offset: nextOffset, size: context.file.size, modifiedAt: context.file.modifiedAt, pendingText: parsed.pendingText, parserVersion: this.parserVersion } };
  }
}
