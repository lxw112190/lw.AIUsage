export interface JsonlResult<T> {
  values: T[];
  pendingText: string;
  errors: string[];
}

// Codex session metadata and tool events can contain multi-megabyte JSON lines.
export const DEFAULT_MAX_PENDING_BYTES = 8 * 1024 * 1024;

export function parseJsonl<T>(
  text: string,
  pendingText: string,
  maxPendingBytes = DEFAULT_MAX_PENDING_BYTES,
): JsonlResult<T> {
  const combined = pendingText + text;
  const lines = combined.split("\n");
  const last = lines.pop() ?? "";
  const values: T[] = [];
  const errors: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      values.push(JSON.parse(trimmed) as T);
    } catch {
      errors.push("MALFORMED_JSONL");
    }
  }
  const bytes = new TextEncoder().encode(last).byteLength;
  return {
    values,
    pendingText: bytes > maxPendingBytes ? "" : last,
    errors:
      bytes > maxPendingBytes
        ? [...errors, "MALFORMED_JSONL_PENDING_OVERFLOW"]
        : errors,
  };
}
export const readText = (buffer: ArrayBuffer): string =>
  new TextDecoder().decode(buffer);
