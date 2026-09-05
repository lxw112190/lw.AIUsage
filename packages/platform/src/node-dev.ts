import type {
  FileEntry,
  FileStat,
  FileSystemPort,
  PathPort,
  RuntimePlatform,
  WatchHandle,
  WatchPort,
} from "./ports";

interface DevResponse {
  ok: boolean;
  error?: string;
  entries?: FileEntry[];
  stat?: FileStat;
  data?: string;
  home?: string;
}
async function request(
  input: Record<string, string | number>,
): Promise<DevResponse> {
  const response = await fetch("/__aiusage_dev__", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok)
    throw new Error(`Dev native bridge failed: ${response.status}`);
  return (await response.json()) as DevResponse;
}
export class BrowserNodeDevFileSystem implements FileSystemPort {
  async exists(path: string): Promise<boolean> {
    return (await request({ op: "exists", path })).ok;
  }
  async list(path: string): Promise<FileEntry[]> {
    return (await request({ op: "list", path })).entries ?? [];
  }
  async stat(path: string): Promise<FileStat> {
    const result = await request({ op: "stat", path });
    if (!result.stat) throw new Error(result.error ?? "stat failed");
    return result.stat;
  }
  async readRange(
    path: string,
    start: number,
    end?: number,
  ): Promise<ArrayBuffer> {
    const result = await request({
      op: "readRange",
      path,
      start,
      ...(end === undefined ? {} : { end }),
    });
    return Uint8Array.from(atob(result.data ?? ""), (char) =>
      char.charCodeAt(0),
    ).buffer;
  }
}
class BrowserNodeDevWatch implements WatchPort {
  async watch(
    path: string,
    _options: { recursive?: boolean },
    handler: (path: string) => void,
  ): Promise<WatchHandle> {
    const source = new EventSource(
      `/__aiusage_dev__/watch?path=${encodeURIComponent(path)}`,
    );
    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const parsed: unknown = JSON.parse(event.data);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof (parsed as { path?: unknown }).path === "string"
        )
          handler((parsed as { path: string }).path);
      } catch {
        /* Ignore malformed bridge notifications. */
      }
    };
    return { close: async () => source.close() };
  }
}
const paths: PathPort = {
  home: async () => (await request({ op: "home" })).home ?? "",
  appData: async () => (await request({ op: "home" })).home ?? "",
  appCache: async () => (await request({ op: "home" })).home ?? "",
};
export const createNodeDevPlatform = (): RuntimePlatform => ({
  kind: "node-dev",
  paths,
  fs: new BrowserNodeDevFileSystem(),
  watch: new BrowserNodeDevWatch(),
});
