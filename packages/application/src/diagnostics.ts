export type DiagnosticLevel = "INFO" | "WARN" | "ERROR";
export interface DiagnosticEntry { id: string; timestamp: number; level: DiagnosticLevel; message: string; source?: string; }

const redactPath = (value: string): string => value.replace(/[A-Za-z]:[\\/][^\s"']+/g, "<local-path>").replace(/(?:\/Users\/|\/home\/)[^\s"']+/g, "<local-path>");
export class DiagnosticsService {
  private readonly entries: DiagnosticEntry[] = [];
  constructor(private readonly limit = 500) {}
  add(level: DiagnosticLevel, message: string, source?: string): DiagnosticEntry { const entry = { id: `${Date.now()}-${this.entries.length}`, timestamp: Date.now(), level, message, source }; this.entries.push(entry); if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit); return entry; }
  list(): DiagnosticEntry[] { return [...this.entries]; }
  exportJson(): string { return JSON.stringify(this.entries.map((entry) => ({ ...entry, message: redactPath(entry.message) })), null, 2); }
}
