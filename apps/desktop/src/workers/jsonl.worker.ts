import { parseJsonl } from "@lw-aiusage/collectors";

interface ParseRequest {
  id: number;
  text: string;
  pendingText: string;
}
interface ParseResponse {
  id: number;
  values: unknown[];
  pendingText: string;
  errors: string[];
}
interface WorkerScope {
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null;
  postMessage(message: ParseResponse): void;
}
const workerScope = globalThis as unknown as WorkerScope;
workerScope.onmessage = (event: MessageEvent<ParseRequest>) => {
  const result = parseJsonl<unknown>(event.data.text, event.data.pendingText);
  workerScope.postMessage({
    id: event.data.id,
    values: result.values,
    pendingText: result.pendingText,
    errors: result.errors,
  });
};
