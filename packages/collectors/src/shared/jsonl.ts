export interface JsonlResult<T> { values: T[]; pendingText: string; errors: string[]; }
export function parseJsonl<T>(text: string, pendingText: string, maxPendingBytes = 512 * 1024): JsonlResult<T> {
  const combined = pendingText + text;
  const lines = combined.split("\n");
  const last = lines.pop() ?? "";
  const values: T[] = [];
  const errors: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { values.push(JSON.parse(trimmed) as T); } catch { errors.push("MALFORMED_JSONL"); }
  }
  const bytes = new TextEncoder().encode(last).byteLength;
  return { values, pendingText: bytes > maxPendingBytes ? "" : last, errors: bytes > maxPendingBytes ? [...errors, "MALFORMED_JSONL_PENDING_OVERFLOW"] : errors };
}
export const readText = (buffer: ArrayBuffer): string => new TextDecoder().decode(buffer);
