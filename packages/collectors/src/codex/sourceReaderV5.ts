import type { CollectorContext, CollectorFile } from "../types";
import { parseJsonl, readText } from "../shared/jsonl";
import type { UnknownCodexEvent } from "./types";
import type { CodexParsedFileInputV5 } from "./parserV5";

export const CODEX_V5_READ_CHUNK_BYTES = 1024 * 1024;

export async function readCodexSourceFileV5(
  context: CollectorContext,
  file: CollectorFile,
): Promise<CodexParsedFileInputV5> {
  const values: UnknownCodexEvent[] = [];
  const parseErrors: string[] = [];
  let pendingText = "";
  let offset = 0;
  const decoder = new TextDecoder();
  const consume = (text: string): void => {
    const parsed = parseJsonl<UnknownCodexEvent>(text, pendingText);
    pendingText = parsed.pendingText;
    for (const value of parsed.values) values.push(value);
    for (const error of parsed.errors) parseErrors.push(error);
  };

  while (offset < file.size) {
    const end = Math.min(file.size, offset + CODEX_V5_READ_CHUNK_BYTES);
    const bytes = await context.platform.fs.readRange(file.path, offset, end);
    consume(decoder.decode(new Uint8Array(bytes), { stream: true }));
    offset = end;
  }
  const tail = decoder.decode();
  if (tail) consume(tail);
  return {
    sourcePath: file.path,
    logicalIdHint: file.logicalId,
    values,
    parseErrors,
    hasPendingText: pendingText.trim().length > 0,
  };
}

export async function readCodexSourceFilesV5(
  context: CollectorContext,
  files: readonly CollectorFile[],
): Promise<CodexParsedFileInputV5[]> {
  const inputs: CodexParsedFileInputV5[] = [];
  for (const [index, file] of files.entries()) {
    inputs.push(await readCodexSourceFileV5(context, file));
    context.onProgress?.({ source: "codex", current: index + 1, total: files.length, path: file.path });
  }
  return inputs;
}
