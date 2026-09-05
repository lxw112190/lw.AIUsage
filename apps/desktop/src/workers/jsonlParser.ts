import type { JsonlParserPort } from "@lw-aiusage/collectors";

interface ParseResponse { id: number; values: unknown[]; pendingText: string; errors: string[]; }
interface PendingRequest { resolve: (value: { values: unknown[]; pendingText: string; errors: string[] }) => void; reject: (reason: Error) => void; }

export class JsonlWorkerParser implements JsonlParserPort {
  private readonly worker: Worker;
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  constructor() {
    this.worker = new Worker(new URL("./jsonl.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<ParseResponse>) => { const request = this.pending.get(event.data.id); if (!request) return; this.pending.delete(event.data.id); request.resolve({ values: event.data.values, pendingText: event.data.pendingText, errors: event.data.errors }); };
    this.worker.onerror = (event: ErrorEvent) => { for (const request of this.pending.values()) request.reject(new Error(event.message || "JSONL parser worker failed")); this.pending.clear(); };
  }
  parse(text: string, pendingText: string): Promise<{ values: unknown[]; pendingText: string; errors: string[] }> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, text, pendingText }); });
  }
  terminate(): void { this.worker.terminate(); this.pending.clear(); }
}
