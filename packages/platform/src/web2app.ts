import type {
  FileEntry,
  FileStat,
  FileSystemPort,
  PathPort,
  RuntimePlatform,
  WatchHandle,
  WatchPort,
} from "./ports";

export interface NativeLwApi {
  invoke(method: string, params?: unknown): Promise<unknown>;
  on(event: string, handler: (data: unknown) => void): void;
  off(event: string, handler: (data: unknown) => void): void;
}

declare global {
  interface Window {
    lw?: NativeLwApi;
  }
}

interface NativeEntry {
  name?: unknown;
  path?: unknown;
  type?: unknown;
  size?: unknown;
  modifiedAt?: unknown;
}
interface NativeGrant {
  id?: unknown;
  url?: unknown;
  size?: unknown;
}
interface NativeListResult {
  entries?: unknown;
}

const nativeApi = (): NativeLwApi | undefined =>
  typeof window !== "undefined" ? window.lw : undefined;
const numberValue = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const normalizePath = (value: string): string =>
  value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
const parentPath = (value: string): string => {
  const slash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  if (slash < 0) return value;
  if (slash === 2 && value[1] === ":") return value.slice(0, 3);
  return value.slice(0, slash) || value.slice(0, 1);
};
const joinPath = (root: string, relative: string): string =>
  `${root.replace(/[\\/]$/, "")}/${relative.replace(/^[/\\]/, "")}`;

async function invoke<T>(method: string, params?: unknown): Promise<T> {
  const api = nativeApi();
  if (!api) throw new Error("lw.Web2App Native IPC is unavailable");
  return (await api.invoke(method, params)) as T;
}

function entryOf(value: NativeEntry): FileEntry | undefined {
  if (typeof value.name !== "string" || typeof value.path !== "string")
    return undefined;
  const type = value.type;
  return {
    path: value.path,
    name: value.name,
    isFile: type === "file",
    isDirectory: type === "directory",
    size: numberValue(value.size),
    modifiedAt: numberValue(value.modifiedAt),
  };
}

export class Web2AppFileSystem implements FileSystemPort {
  private readQueue: Promise<void> = Promise.resolve();

  private enqueueRead<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.readQueue.then(operation, operation);
    this.readQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async exists(path: string): Promise<boolean> {
    const result = await invoke<{ exists?: unknown }>("fs.exists", { path });
    return result.exists === true;
  }

  async list(path: string): Promise<FileEntry[]> {
    const result = await invoke<NativeListResult>("fs.list", { path });
    if (!Array.isArray(result.entries)) return [];
    return result.entries.flatMap((value) =>
      typeof value === "object" && value !== null
        ? [entryOf(value as NativeEntry)].filter(
            (entry): entry is FileEntry => entry !== undefined,
          )
        : [],
    );
  }

  async stat(path: string): Promise<FileStat> {
    const entry = (await this.list(parentPath(path))).find(
      (item) => normalizePath(item.path) === normalizePath(path),
    );
    if (!entry) throw new Error(`Native file was not found: ${path}`);
    return {
      size: entry.size,
      modifiedAt: entry.modifiedAt,
      isFile: entry.isFile,
    };
  }

  async readRange(
    path: string,
    start: number,
    end?: number,
  ): Promise<ArrayBuffer> {
    return this.enqueueRead(() => this.readRangeInternal(path, start, end));
  }

  private async readRangeInternal(
    path: string,
    start: number,
    end?: number,
  ): Promise<ArrayBuffer> {
    if (end !== undefined && end <= start) return new ArrayBuffer(0);
    const grant = await invoke<NativeGrant>("fs.openRead", { path });
    if (typeof grant.id !== "string" || typeof grant.url !== "string")
      throw new Error("Native file grant is invalid");
    try {
      if (typeof grant.size === "number" && start >= grant.size)
        return new ArrayBuffer(0);
      const headers: Record<string, string> = {};
      if (start > 0 || end !== undefined)
        headers.Range = `bytes=${start}-${end === undefined ? "" : Math.max(start, end - 1)}`;
      const response = await fetch(grant.url, { headers });
      if (
        response.status === 416 &&
        typeof grant.size === "number" &&
        start >= grant.size
      )
        return new ArrayBuffer(0);
      if (!response.ok)
        throw new Error(`Native file read failed: ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const selected =
        response.status === 200
          ? bytes.slice(Math.min(start, bytes.length), end)
          : bytes;
      return selected.buffer;
    } finally {
      await invoke("file.revoke", { id: grant.id }).catch(() => undefined);
    }
  }
}

class Web2AppWatch implements WatchPort {
  async watch(
    path: string,
    options: { recursive?: boolean },
    handler: (path: string) => void,
  ): Promise<WatchHandle> {
    const api = nativeApi();
    if (!api) throw new Error("lw.Web2App Native IPC is unavailable");
    const result = await invoke<{ watcherId?: unknown }>("fs.watch", {
      path,
      recursive: options.recursive ?? true,
      debounceMs: 2000,
    });
    if (typeof result.watcherId !== "string")
      throw new Error("Native watcher ID is invalid");
    const watcherId = result.watcherId;
    const onChanged = (data: unknown): void => {
      if (typeof data !== "object" || data === null) return;
      const event = data as {
        watcherId?: unknown;
        overflow?: unknown;
        changes?: unknown;
      };
      if (event.watcherId !== watcherId) return;
      if (event.overflow === true || !Array.isArray(event.changes)) {
        handler(path);
        return;
      }
      for (const change of event.changes) {
        if (
          typeof change === "object" &&
          change !== null &&
          typeof (change as { relativePath?: unknown }).relativePath ===
            "string"
        )
          handler(
            joinPath(path, (change as { relativePath: string }).relativePath),
          );
      }
    };
    api.on("fs.changed", onChanged);
    return {
      close: async () => {
        api.off("fs.changed", onChanged);
        await invoke("fs.unwatch", { watcherId }).catch(() => undefined);
      },
    };
  }
}

const nativePaths: PathPort = {
  home: async () =>
    (await invoke<{ path?: unknown }>("app.getPath", { name: "home" }))
      .path as string,
  appData: async () =>
    (await invoke<{ path?: unknown }>("app.getPath", { name: "appData" }))
      .path as string,
  appCache: async () =>
    (await invoke<{ path?: unknown }>("app.getPath", { name: "appCache" }))
      .path as string,
};

export const isWeb2AppRuntime = (): boolean => nativeApi() !== undefined;
export const createWeb2AppPlatform = (): RuntimePlatform => ({
  kind: "lw-web2app",
  paths: nativePaths,
  fs: new Web2AppFileSystem(),
  watch: new Web2AppWatch(),
});
